# Installation

## Recommended environment

The provided Conda specification targets Python 3.12 and includes Flask, MDAnalysis, NetworkX, NumPy, SciPy, scikit-learn, and fpocket 4.2.3 from conda-forge. Use an isolated environment to avoid changing an existing scientific software installation.

```bash
git clone https://github.com/norman-geist/Allosteric-Explorer.git Allosteric_Explorer
cd Allosteric_Explorer
conda env create -f environment.yml
conda activate allosteric-explorer
fpocket -h
chmod +x Allosteric_Explorer.py
./Allosteric_Explorer.py
```

While the repository is private, cloning requires GitHub access. An extracted source download can be used instead of `git clone`.

Install Chromium or Google Chrome before launching. With no arguments, the executable opens a dedicated browser app window automatically and stops its backend when that window closes. No manually opened browser tab or `--server` flag is needed. The scientific calculations run in Python; Node.js is not a runtime dependency.

## Default app-window launch on Linux

After the one-time installation and executable-permission setup above, activate the environment and launch the executable directly from your chosen working directory:

```bash
conda activate allosteric-explorer
/path/to/Allosteric_Explorer/Allosteric_Explorer.py
```

The launcher opens a dedicated app window, chooses a free loopback port, and stops the backend when the window closes. Export paths are based on your launch working directory. If executable permissions are missing after download, run `chmod +x /path/to/Allosteric_Explorer/Allosteric_Explorer.py` once. `python /path/to/Allosteric_Explorer/Allosteric_Explorer.py` is an equivalent app-mode launch when direct execution is unavailable. Specify a browser executable if automatic detection fails:

```bash
/path/to/Allosteric_Explorer/Allosteric_Explorer.py --browser /path/to/chromium
```

For native file dialogs, install `kdialog` on KDE Plasma or `zenity` on GNOME. On openSUSE, for example:

```bash
sudo zypper install kdialog
# Alternatively, for a GNOME setup:
sudo zypper install zenity
```

Without a native dialog helper, use the app's browser-based file chooser. Desktop launching is documented for Linux; other platforms require checking browser availability and fpocket installation. Server mode avoids the dedicated-window requirement.

## Existing Python environment

```bash
python -m pip install -r requirements.txt
conda install -c conda-forge fpocket=4.2.3
chmod +x Allosteric_Explorer.py
./Allosteric_Explorer.py
```

The requirements file contains Python packages; fpocket is an external executable and must be installed separately. The app searches the active environment and PATH for fpocket. Do not install the Python requirements into a system-managed interpreter; use a virtual or Conda environment.

## Optional server mode and remote access

For an ordinary browser tab, run `./Allosteric_Explorer.py --server`, open http://127.0.0.1:8765, and keep the terminal running. Stop this mode with Ctrl+C. Choose another local port when 8765 is already in use:

```bash
python Allosteric_Explorer.py --server --port 8766
```

For a remote analysis machine, start the app there and use an SSH tunnel from your workstation:

```bash
# Remote machine, in the repository and active environment:
python Allosteric_Explorer.py --server --port 8765

# Your workstation, in a separate terminal:
ssh -N -L 8765:127.0.0.1:8765 your-user@your-server
```

Open http://127.0.0.1:8765 on your workstation. Topology and trajectory paths refer to files on the backend machine. The application binds to loopback and is intended for local use or a controlled tunnel, rather than deployment as a public multi-user service.

## Inputs and practical checks

Use the first model of a protein PDB as reference and supply a matching trajectory topology. Preserve chain and segment identifiers when numbering repeats. Make periodic trajectories whole and image them consistently before analysis: distance calculations do not apply minimum-image corrections. Pocket tracking requires all reference protein heavy atoms within the scan scope.

The **Global settings** gear controls CPU workers for frame-parallel SASA and pocket tracking. Start with the default of four workers, or one for sequential execution. Frame caps and trajectory stride control analysis cost; record the final retained frame list.

If a module cannot be imported, confirm that the terminal has the `allosteric-explorer` environment activated. If fpocket is missing, check `command -v fpocket` in the same environment. If desktop launch fails, use `--server`. If residue mapping fails, inspect the reference/topology selection and chain, segment, residue, insertion-code, and residue-name correspondence.

For workflow details and selection examples, see [USAGE.md](USAGE.md). For reproducible reporting, see [METHODS.md](METHODS.md).
