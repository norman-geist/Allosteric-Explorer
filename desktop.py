"""Open Allosteric Explorer in an isolated Chromium app window."""
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread

from werkzeug.serving import make_server


FILE_TYPES = {
    "structure": ("PDB structure files", "*.pdb *.ent"),
    "topology": ("Topology files", "*.psf *.pdb *.ent *.prmtop *.parm7 *.top *.tpr *.gro *.mol2"),
    "trajectory": ("Trajectory files", "*.dcd *.xtc *.trr *.nc *.ncdf *.netcdf *.trj *.mdcrd"),
    "csv": ("Observable CSV files", "*.csv"),
    "vmd": ("VMD scripts", "*.tcl"),
    "pymol": ("PyMOL scripts", "*.py"),
    "png": ("PNG images", "*.png"),
    "svg": ("SVG figures", "*.svg"),
    "json": ("JSON files", "*.json"),
}


def file_dialog_helper():
    desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").lower().split(":")
    helpers = ("kdialog", "zenity") if "kde" in desktop else ("zenity", "kdialog")
    for helper in helpers:
        executable = shutil.which(helper)
        if executable:
            return helper, executable
    return None


def choose_file(kind, start, *, save_name=None):
    if not isinstance(kind, str) or kind not in FILE_TYPES or not isinstance(start, str):
        raise ValueError("Invalid file chooser request.")
    dialog = file_dialog_helper()
    if dialog is None:
        raise RuntimeError("Install kdialog (KDE) or zenity (GNOME) to use the system file chooser.")
    helper, executable = dialog

    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        raise RuntimeError("Open the app from a graphical session to use the system file chooser.")

    launch_directory = Path.cwd()
    location = Path(start).expanduser().absolute() if start else launch_directory
    if not location.is_dir():
        location = location.parent
    if not location.is_dir():
        location = launch_directory
    initial_path = str(location / save_name) if save_name else os.path.join(location, "")
    label, patterns = FILE_TYPES[kind]
    # Include common uppercase extensions on case-sensitive filesystems.
    patterns = f"{patterns} {patterns.upper()}"
    title = f"Allosteric Explorer — Save {save_name}" if save_name else (
        f"Allosteric Explorer — Choose {label.removesuffix(' files').lower()}"
    )
    if helper == "kdialog":
        action = "--getsavefilename" if save_name else "--getopenfilename"
        args = ["--title", title, action, initial_path, f"{label} ({patterns});;All files (*)"]
    else:
        args = [
            "--file-selection", f"--title={title}", f"--filename={initial_path}",
            f"--file-filter={label} | {patterns}", "--file-filter=All files | *",
        ]
        if save_name:
            args.append("--save")
    result = subprocess.run([executable, *args], capture_output=True, text=True, check=False)
    if result.returncode == 1:
        return None
    if result.returncode != 0:
        details = result.stderr.strip()
        raise RuntimeError(f"The system file chooser failed ({helper}, exit {result.returncode}). {details}".rstrip())

    filename = result.stdout.removesuffix("\n")
    if not filename or (not save_name and not Path(filename).is_file()):
        raise ValueError("Choose an existing local file.")
    return filename


def find_browser(override):
    if override:
        path = shutil.which(str(Path(override).expanduser()))
        if not path:
            raise RuntimeError(f"Browser executable was not found: {override}")
        return path

    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        path = shutil.which(name)
        if path:
            return path
    raise RuntimeError("Install Chromium or Google Chrome, or pass --browser /path/to/executable.")


def launch(app, browser_override=None):
    browser = find_browser(browser_override)
    app.config["DESKTOP_MODE"] = True
    with TemporaryDirectory(prefix="allosteric-explorer-") as profile:
        # Bind before opening the window. Port zero lets the OS pick a free port.
        with make_server("127.0.0.1", 0, app, threaded=True) as server:
            url = f"http://127.0.0.1:{server.server_port}"
            service = Thread(target=server.serve_forever, daemon=True)
            service.start()
            try:
                with subprocess.Popen([
                    browser,
                    f"--app={url}",
                    f"--user-data-dir={profile}",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-background-mode",
                    "--disable-extensions",
                    "--window-size=1440,960",
                ]) as window:
                    try:
                        status = window.wait()
                    except KeyboardInterrupt:
                        window.terminate()
                        return
                if status:
                    raise RuntimeError(f"The browser exited with status {status}. Start desktop mode from a graphical session.")
            finally:
                server.shutdown()
                service.join()
