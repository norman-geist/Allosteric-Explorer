#!/usr/bin/env python3
"""Open Allosteric Explorer in a desktop window or use --server."""
import argparse
from collections import OrderedDict
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from fnmatch import fnmatch
from itertools import count
import math
import os
from pathlib import Path
import secrets
import re
import progress
from shutil import copyfileobj
from threading import Lock

from flask import Flask, jsonify, request, g

from conformations import aligned_frame_pdb, compare_state_contacts, embedding, frame_structure, observable_values, residue_associations, welch_cluster_pairs
from perturbation import scan_response
from engine import MAX_TRAJECTORY_FRAMES, alternate_routes, analyze, cpu_workers, detect_pockets, fpocket_executable, open_trajectory, parse_structure, pdb_residue_key, trajectory_inputs

app = Flask(__name__, static_url_path="/assets")
app.config.update(MAX_CONTENT_LENGTH=24 * 1024 * 1024,
                  TRUSTED_HOSTS=["127.0.0.1", "localhost"])
APP_VERSION = "1.0.0"
TOKEN = secrets.token_urlsafe(32)
ROUTE_RUNS = OrderedDict()
ROUTE_LOCK = Lock()
CONFORMATION_RUNS = OrderedDict()
CONFORMATION_LOCK = Lock()
EXPORT_EXTENSIONS = {"structure": (".pdb", ".ent"), "vmd": (".tcl",), "pymol": (".py",),
                     "png": (".png",), "svg": (".svg",), "csv": (".csv",), "json": (".json",)}


def numeric(data, key, cast, low, high):
    value = cast(data[key])
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{key} must be between {low} and {high}.")
    return value


def requested_cpu_workers(data):
    return numeric({"workers": str(data.get("workers", 4))}, "workers", int, 1, 100)


@app.before_request
def check_request():
    if request.method == "POST" and request.headers.get("X-Explorer-Token") != TOKEN:
        return jsonify(error="Reload the app page before running a calculation."), 403
    job = request.headers.get("X-Explorer-Job", "")
    if request.method == "POST" and re.fullmatch(r"[A-Za-z0-9_-]{8,80}", job):
        g.progress_token = progress.start(job)


@app.after_request
def finish_progress(response):
    if hasattr(g, "progress_token"):
        progress.finish(g.progress_token, failed=response.status_code >= 400)
    return response


@app.get("/api/progress/<job>")
def job_progress(job):
    if request.headers.get("X-Explorer-Token") != TOKEN:
        return jsonify(error="Reload the app page."), 403
    row = progress.read(job)
    response = jsonify(row or dict(status="waiting", stage="Waiting for analysis worker"))
    response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(413)
def too_large(_):
    kind = "export file" if request.path.startswith("/api/export/") else "uploaded structure"
    limit = request.max_content_length // (1024 * 1024)
    return jsonify(error=f"The {kind} exceeds {limit} MB."), 413


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/methods")
def methods_description():
    return app.response_class(Path(__file__).with_name("METHODS.md").read_text(), mimetype="text/plain")


@app.route("/api/session")
def session():
    from desktop import file_dialog_helper

    desktop = app.config.get("DESKTOP_MODE", False)
    response = jsonify(
        token=TOKEN,
        version=APP_VERSION,
        fpocket=bool(fpocket_executable()),
        desktop=desktop,
        native_pdb=desktop and bool(file_dialog_helper()),
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/pick-file")
def pick_file():
    if not app.config.get("DESKTOP_MODE"):
        return jsonify(error="Enter a path on the machine running the server."), 403

    from desktop import choose_file

    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="Invalid file chooser request."), 400
    try:
        kind = data.get("kind")
        path = choose_file(kind, data.get("start", ""))
        if kind == "structure":
            if path is None:
                return jsonify(structure=None)
            return jsonify(structure=load_structure_path(path))
        return jsonify(path=path)
    except (OSError, RuntimeError, ValueError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/trajectory-info")
def trajectory_info():
    try:
        reader = open_trajectory(request.get_json()).trajectory
        try:
            return jsonify(frames=len(reader))
        finally:
            reader.close()
    except (OSError, RuntimeError, ValueError, KeyError, TypeError, IndexError, ImportError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/browse-files")
def browse_files():
    from desktop import FILE_TYPES

    data = request.get_json()
    try:
        kind, start = data["kind"], data.get("path", "")
        if kind not in ("structure", "topology", "trajectory", "csv") or not isinstance(start, str):
            raise ValueError("Choose a supported file type and directory.")
        path = Path(start or ".").expanduser()
        if not path.is_dir():
            path = path.parent
        path = path.resolve(strict=True)
        patterns = FILE_TYPES[kind][1].split()
        folders, files = [], []
        for entry in path.iterdir():
            try:
                if entry.is_dir():
                    folders.append(entry.name)
                elif any(fnmatch(entry.name.lower(), pattern) for pattern in patterns) and entry.is_file():
                    files.append(entry.name)
            except OSError:
                continue
        return jsonify(path=str(path), parent=str(path.parent), separator=os.sep,
                       folders=sorted(folders, key=str.casefold), files=sorted(files, key=str.casefold))
    except (OSError, RuntimeError, TypeError, ValueError, KeyError) as error:
        return jsonify(error=str(error)), 400


def load_structure_path(path):
    local_file = Path(path).expanduser()
    if not local_file.is_file():
        raise ValueError("Choose a PDB file on the server.")
    with local_file.open("rb") as file:
        return load_structure(file, local_file.name)


@app.post("/api/structure-path")
def structure_path():
    try:
        return jsonify(load_structure_path(request.get_json()["path"]))
    except (OSError, RuntimeError, TypeError, ValueError, KeyError) as error:
        return jsonify(error=str(error)), 400


def load_structure(file, name):
    if not name.lower().endswith((".pdb", ".ent")):
        raise ValueError("Choose a PDB structure (.pdb or .ent).")
    limit = app.config["MAX_CONTENT_LENGTH"]
    content = file.read(limit + 1)
    if len(content) > limit:
        raise ValueError("The structure exceeds 24 MB.")
    return parse_structure(content.decode("utf-8"), name)[0]


@app.post("/api/structure")
def structure():
    try:
        file = request.files.get("structure")
        if not file:
            raise ValueError("Choose a PDB structure (.pdb or .ent).")
        return jsonify(load_structure(file, Path(file.filename).name))
    except (OSError, ValueError) as error:
        return jsonify(error=str(error)), 400


def fpocket_options(settings):
    if not isinstance(settings, dict):
        raise ValueError("Invalid fpocket settings.")
    options = []
    values = {}
    for key, flag, cast, low, high in (
        ("min_radius", "-m", float, 0.1, 100),
        ("max_radius", "-M", float, 0.1, 100),
        ("min_spheres", "-i", int, 1, 10000),
        ("clustering_distance", "-D", float, 0.1, 100),
    ):
        if key in settings:
            values[key] = numeric(settings, key, cast, low, high)
            options.extend((flag, str(values[key])))
    if values.get("min_radius", 3.4) >= values.get("max_radius", 6.2):
        raise ValueError("The minimum alpha-sphere radius must be below the maximum.")
    if "clustering_method" in settings:
        method = settings["clustering_method"]
        if method not in ("s", "m", "a", "c"):
            raise ValueError("Choose a supported fpocket clustering method.")
        options.extend(("-C", method))
    return options


def pocket_detector(detector, residues, chain):
    if chain is None:
        return detector
    ids = {r["id"] for r in residues if r["chain"] == chain}
    if not ids:
        raise ValueError("Choose a chain from the loaded PDB.")
    return "\n".join(
        line for line in detector.splitlines()
        if line.startswith("ATOM  ") and int(line[22:26]) in ids
    ) + "\nEND\n"


@app.post("/api/pockets")
def pockets():
    try:
        data = request.get_json()
        model, detector = parse_structure(data["pdb"], "")
        residues = model["residues"]
        detector = pocket_detector(detector, residues, data.get("chain"))
        options = fpocket_options(data.get("settings", {}))
        results = detect_pockets(detector, len(residues), fpocket_executable(), options)
        return jsonify(pockets=results)
    except (OSError, ValueError, TypeError, KeyError) as error:
        return jsonify(error=str(error)), 400


def pocket_tracking_frames(model, settings):
    settings = settings.copy()
    settings["stride"] = numeric(settings, "stride", int, 1, 1000000)
    settings["max_frames"] = numeric(settings, "max_frames", int, 1, 1000)
    return trajectory_inputs(model, settings, min_frames=1, max_explicit_frames=1000)


@app.post("/api/pockets/track")
def track_pockets():
    try:
        data = request.get_json()
        model, detector = parse_structure(data["pdb"], "")
        residues = model["residues"]
        chain = data.get("chain")
        options = fpocket_options(data.get("fpocket", {}))
        executable = fpocket_executable()
        if not executable:
            raise ValueError("Install fpocket to track pockets.")
        reference = pocket_detector(detector, residues, chain)
        legacy = "pockets" not in data
        requested = [{"id": 1, "lining": data["lining"]}] if legacy else data["pockets"]
        if not isinstance(requested, list) or not requested:
            raise ValueError("Show at least one detected pocket to track.")
        valid_ids = {int(line[22:26]) for line in reference.splitlines() if line.startswith("ATOM  ")}
        targets = {}
        for pocket in requested:
            pocket_id = pocket["id"]
            if type(pocket_id) is not int or pocket_id < 1 or pocket_id in targets:
                raise ValueError("Choose distinct reference pocket numbers.")
            target = set(pocket["lining"])
            if not target or not target <= valid_ids:
                raise ValueError("Choose detected pockets in the scanned chains.")
            targets[pocket_id] = target
        overlap = numeric(data, "overlap", float, 0.01, 1)
        requested_workers = requested_cpu_workers(data)
        universe, atoms, matched, indices = pocket_tracking_frames(model, data["trajectory"])
        workers = cpu_workers(requested_workers, len(indices))

        # Keep the original detector's atom and residue numbering on every frame.
        view_lines = model["pdb"].splitlines()
        detector_lines = detector.splitlines()
        templates = {}
        for line, converted in zip(view_lines, detector_lines):
            if not line.startswith("ATOM  ") or int(converted[22:26]) not in valid_ids:
                continue
            atom_name = line[12:16].strip()
            element = line[76:78].strip().upper()
            hydrogen = element in ("H", "D") if element else atom_name.lstrip("0123456789").startswith(("H", "D"))
            templates[(pdb_residue_key(line), atom_name)] = (converted, hydrogen)

        samples = {pocket_id: [] for pocket_id in targets}

        pending = {}

        completed_frames = 0
        progress.report("Running fpocket on sampled frames", 0, len(indices))
        def collect_frames():
            nonlocal completed_frames
            completed, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in completed:
                index = pending.pop(future)
                try:
                    candidates = future.result()
                except (OSError, ValueError) as error:
                    raise ValueError(f"Frame {index}: {error}") from error
                completed_frames += 1
                progress.report("Running fpocket on sampled frames", completed_frames, len(indices))
                for pocket_id, target in targets.items():
                    match, score = match_tracked_pocket(target, candidates, overlap)
                    samples[pocket_id].append(dict(frame=index, detected=match is not None, overlap=score,
                                                   volume=match["volume"] if match is not None else None))

        # The trajectory reader stays on this thread. Workers receive only independent PDB strings.
        with ThreadPoolExecutor(max_workers=workers) as pool:
            try:
                for index in map(int, indices):
                    universe.trajectory[index]
                    pdb = aligned_frame_pdb(model, atoms, matched)
                    coordinates = {
                        (pdb_residue_key(line), line[12:16].strip()): line[30:54]
                        for line in pdb.splitlines() if line.startswith("ATOM  ")
                    }
                    lines = []
                    for key, (template, hydrogen) in templates.items():
                        if key in coordinates:
                            lines.append(template[:30] + coordinates[key] + template[54:])
                        elif not hydrogen:
                            raise ValueError(f"Frame {index}: the trajectory topology is missing {key[1]} in residue {key[0][2]} of the reference PDB.")
                    future = pool.submit(detect_pockets, "\n".join(lines + ["END", ""]), len(residues), executable, options)
                    pending[future] = index
                    if len(pending) == workers:
                        collect_frames()
                while pending:
                    collect_frames()
            finally:
                for future in pending:
                    future.cancel()
        for rows in samples.values():
            rows.sort(key=lambda row: row["frame"])
        if legacy:
            return jsonify(samples=samples[1])
        return jsonify(pockets=[dict(id=pocket_id, samples=rows) for pocket_id, rows in samples.items()],
                       workers=workers)
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


def tracked_frame_structure(model, trajectory, frame):
    if type(frame) is not int:
        raise ValueError("Choose a sampled tracking frame.")
    if frame == -1:
        return model["pdb"], "Original PDB · frame −1"
    universe, atoms, matched, indices = pocket_tracking_frames(model, trajectory)
    if frame not in indices:
        raise ValueError("Choose a sampled tracking frame.")
    universe.trajectory[frame]
    return aligned_frame_pdb(model, atoms, matched), f"{Path(trajectory['trajectory']).stem} · frame {frame}"


@app.post("/api/pockets/track/preview")
def preview_tracked_frame():
    try:
        data = request.get_json()
        model, _ = parse_structure(data["pdb"], "")
        pdb, name = tracked_frame_structure(model, data["trajectory"], data["frame"])
        return jsonify(pdb=pdb, name=name)
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/pockets/track/frame")
def detect_tracked_frame():
    try:
        data = request.get_json()
        model, _ = parse_structure(data["pdb"], "")
        reference_ids = set(data["lining"])
        if not reference_ids or not reference_ids <= {r["id"] for r in model["residues"]}:
            raise ValueError("Choose a tracked reference pocket.")
        overlap = numeric(data, "overlap", float, 0.01, 1)
        pdb, name = tracked_frame_structure(model, data["trajectory"], data["frame"])
        structure, detector = parse_structure(pdb, name)
        detector = pocket_detector(detector, structure["residues"], data.get("chain"))
        options = fpocket_options(data.get("fpocket", {}))
        results = detect_pockets(detector, len(structure["residues"]), fpocket_executable(), options)
        def identity(residue):
            return tuple(residue[key] for key in ("chain", "segid", "resid", "icode"))

        original_ids = {identity(r): r["id"] for r in model["residues"]}
        to_reference = {r["id"]: original_ids[identity(r)] for r in structure["residues"]}
        candidates = [dict(id=p["id"], residues=[to_reference[node] for node in p["residues"]])
                      for p in results]
        match, score = match_tracked_pocket(reference_ids, candidates, overlap)
        return jsonify(structure=structure, pockets=results,
                       tracking=dict(lining=[node for node, original in to_reference.items() if original in reference_ids],
                                     match=match["id"] if match else None, overlap=score))
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


def match_tracked_pocket(target, candidates, minimum):
    best, score = None, 0.0
    for candidate in candidates:
        lining = set(candidate["residues"])
        overlap = len(target & lining) / len(target | lining)
        if overlap > score:
            best, score = candidate, overlap
    return (best if score >= minimum else None), score


@app.post("/api/communication")
def communication():
    try:
        data = request.get_json()
        model, _ = parse_structure(data["pdb"], "")
        settings = data["settings"]
        if settings["method"] not in {"dcc", "contacts"}:
            raise ValueError("Choose a supported coupling method.")
        if settings.get("candidate_filter", "all") not in {"all", "surface", "buried"}:
            raise ValueError("Choose a supported candidate filter.")
        if settings.get("candidate_filter", "all") != "all":
            settings["workers"] = requested_cpu_workers(settings)
        for key, default in (("min_distance", 0), ("sasa_threshold", 25),
                             ("sasa_snapshots", 12), ("sasa_points", 120)):
            settings.setdefault(key, default)
        for key, cast, low, high in (
            ("stride", int, 1, 1000000), ("max_frames", int, 20, MAX_TRAJECTORY_FRAMES),
            ("cutoff", float, 2, 25), ("occupancy", float, 0, 1),
            ("coupling", float, 0, 1),
            ("min_distance", float, 0, 1000), ("sasa_threshold", float, 0, 1000),
            ("sasa_snapshots", int, 1, 240), ("sasa_points", int, 32, 960),
        ):
            settings[key] = numeric(settings, key, cast, low, high)
        route_context = {}
        result = analyze(model, data["pockets"], settings, route_context=route_context)
        run_id = secrets.token_urlsafe(16)
        with ROUTE_LOCK:
            ROUTE_RUNS[run_id] = route_context
            while len(ROUTE_RUNS) > 2:
                ROUTE_RUNS.popitem(last=False)
        return jsonify(result | {"route_run": run_id})
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError,
            RuntimeError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/routes")
def communication_routes():
    data = request.get_json()
    if not isinstance(data, dict) or not isinstance(data.get("run"), str) or type(data.get("target")) is not int:
        return jsonify(error="Choose a valid analysis and target."), 400
    with ROUTE_LOCK:
        run = ROUTE_RUNS.get(data["run"])
        if run is not None:
            ROUTE_RUNS.move_to_end(data["run"])
    if run is None:
        return jsonify(error="This network is no longer loaded. Run the analysis again."), 404
    target = data["target"]
    if target not in run["targets"]:
        return jsonify(error="Choose a reachable analysis target."), 400
    return jsonify(routes=alternate_routes(run["graph"], run["sources"], target))


def trajectory_signature(settings):
    return tuple((path.stat().st_size, path.stat().st_mtime_ns)
                 for path in (Path(settings[key]).expanduser() for key in ("topology", "trajectory")))


@app.post("/api/conformations")
def conformations():
    try:
        data = request.get_json()
        model, _ = parse_structure(data["pdb"], "")
        settings = data["settings"]
        if settings["basis"] not in {"cartesian", "dihedral", "ccpca"}:
            raise ValueError("Choose Cartesian, backbone dihedral, or contact-contact PCA.")
        if settings["basis"] == "ccpca":
            selections = settings.get("ccpca_selections")
            if (not isinstance(selections, list) or len(selections) != 2
                    or any(not isinstance(selection, str) or not selection.strip() for selection in selections)):
                raise ValueError("Enter two MDAnalysis atom selections for ccPCA.")
        settings.setdefault("clustering", "kmeans")
        if settings["clustering"] not in {"kmeans", "ward", "dbscan"}:
            raise ValueError("Choose k-means, Ward hierarchical clustering, or DBSCAN.")
        for key, low, high in (("stride", 1, 1000000), ("max_frames", 20, MAX_TRAJECTORY_FRAMES), ("components", 2, 20)):
            settings[key] = numeric(settings, key, int, low, high)
        if settings["clustering"] == "dbscan":
            settings["eps"] = numeric(settings, "eps", float, 0.001, 10)
            settings["min_samples"] = numeric(settings, "min_samples", int, 2, MAX_TRAJECTORY_FRAMES)
        else:
            settings["clusters"] = numeric(settings, "clusters", int, 2, 24)
        signature = trajectory_signature(settings)
        result = embedding(model, settings)
        if signature != trajectory_signature(settings):
            raise ValueError("The topology or trajectory changed during analysis. Run PCA again.")
        run_id = secrets.token_urlsafe(16)
        with CONFORMATION_LOCK:
            CONFORMATION_RUNS[run_id] = (model, settings | {"frame_indices": result["frames"]}, signature, result["clusters"])
            while len(CONFORMATION_RUNS) > 2:
                CONFORMATION_RUNS.popitem(last=False)
        return jsonify(result | {"run": run_id})
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


def conformation_run(run_id, *, include_clusters=False):
    with CONFORMATION_LOCK:
        run = CONFORMATION_RUNS.get(run_id)
        if run is not None:
            CONFORMATION_RUNS.move_to_end(run_id)
    if run is None:
        raise ValueError("This PCA run is no longer loaded. Run PCA again.")
    model, settings, signature, clusters = run
    if signature != trajectory_signature(settings):
        raise ValueError("The topology or trajectory changed. Run PCA again.")
    return (model, settings, clusters) if include_clusters else (model, settings)


@app.post("/api/perturbation")
def perturbation():
    try:
        data = request.get_json()
        model, _ = parse_structure(data["pdb"], "")
        cutoff = numeric(data, "cutoff", float, 4, 30)
        pdb = model["pdb"]
        if data.get("reference"):
            reference = data["reference"]
            run_model, settings, clusters = conformation_run(reference["run"], include_clusters=True)
            cluster = next((c for c in clusters if c["id"] == reference["cluster"]), None)
            if not cluster or run_model["pdb"] != pdb:
                raise ValueError("Choose a representative from the current structure's clustering.")
            pdb = frame_structure(run_model, settings, cluster["representative"])
            frame_model, _ = parse_structure(pdb, "")
            keys = ("chain", "segid", "resid", "icode")
            coords = {tuple(r[k] for k in keys): r["ca"] for r in frame_model["residues"]}
            model["residues"] = [dict(r, ca=coords.get(tuple(r[k] for k in keys)))
                                 for r in model["residues"]]
        result = scan_response(model, data["sources"], data["targets"], cutoff)
        return jsonify(result | {"pdb": pdb} if data.get("reference") else result)
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/conformations/contact-changes")
def state_contacts():
    try:
        data = request.get_json()
        model, settings, clusters = conformation_run(data["run"], include_clusters=True)
        clusters = {cluster["id"]: cluster for cluster in clusters}
        first, second = data["states"]
        if first == second or first not in clusters or second not in clusters:
            raise ValueError("Choose two different assigned clusters.")
        cutoff = numeric(data, "cutoff", float, 2, 25)
        if not data["path"] and (not isinstance(data["groups"], list) or len(data["groups"]) != 2):
            raise ValueError("Choose two contact groups.")
        result = compare_state_contacts(model, settings, [clusters[first], clusters[second]],
                                        data["groups"], data["path"], cutoff)
        return jsonify(result)
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/conformations/frame")
def conformation_frame():
    try:
        data = request.get_json()
        model, settings = conformation_run(data["run"])
        frame = data["frame"]
        if type(frame) is not int or frame not in settings["frame_indices"]:
            raise ValueError("Choose a retained frame.")
        return jsonify(pdb=frame_structure(model, settings, frame))
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/conformations/export-frame")
@app.post("/api/export/<kind>")
def export_file(kind="structure"):
    if not app.config.get("DESKTOP_MODE"):
        return jsonify(error="The system save dialog is available in desktop mode."), 403

    from desktop import choose_file

    try:
        file, name, detected_kind = export_upload()
        if kind == "save-as":
            kind = detected_kind
        if kind not in EXPORT_EXTENSIONS:
            raise ValueError("Choose a supported export format.")
        suffixes = EXPORT_EXTENSIONS[kind]
        if detected_kind != kind:
            raise ValueError("The filename does not match the export format.")
        if kind == "structure":
            load_structure(file, name)
            file.seek(0)
        if kind == "png":
            validate_png(file)
        selected = choose_file(kind, "", save_name=name)
        if selected is None:
            return jsonify(path=None)
        path = Path(selected)
        if path.suffix.lower() not in suffixes:
            path = path.with_name(path.name + suffixes[0])
        write_new_export(path, file)
        return jsonify(path=str(path))
    except FileExistsError:
        return jsonify(error="That file already exists. Choose a different name."), 409
    except (OSError, RuntimeError, ValueError) as error:
        return jsonify(error=str(error)), 400


def validate_png(file):
    signature = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"
    if file.read(len(signature)) != signature:
        raise ValueError("Choose a valid PNG image.")
    file.seek(0)


def export_upload():
    # Full correlation matrices can exceed the structure upload limit.
    request.max_content_length = 512 * 1024 * 1024
    file = request.files.get("structure")
    name = file.filename if file is not None else None
    if not name or name != Path(name).name or any(character in name for character in "\\/:\x00"):
        raise ValueError("Provide an export filename without a directory.")
    suffix = Path(name).suffix.lower()
    kind = next((kind for kind, extensions in EXPORT_EXTENSIONS.items() if suffix in extensions), None)
    if kind is None:
        raise ValueError("Choose a supported export format.")
    return file, name, kind


def write_new_export(path, file):
    output = path.open("xb")
    try:
        with output:
            copyfileobj(file, output)
    except OSError:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


@app.post("/api/export/working-directory")
def export_to_working_directory():
    try:
        file, name, kind = export_upload()
        if kind == "png":
            validate_png(file)
        path = Path.cwd() / name
        for number in count(1):
            target = path if number == 1 else path.with_stem(f"{path.stem}_{number}")
            try:
                write_new_export(target, file)
                return jsonify(path=str(target))
            except FileExistsError:
                continue
    except OSError as error:
        return jsonify(error=f"Could not save in the app’s working directory. {error.strerror or error}"), 400
    except ValueError as error:
        return jsonify(error=str(error)), 400


@app.post("/api/conformations/observable")
def conformation_observable():
    try:
        data = request.get_json()
        model, settings = conformation_run(data["run"])
        spec = data["observable"]
        counts = {"minimum": 2, "center": 2, "contacts": 2, "angle": 3,
                  "dihedral": 4, "rmsd": 1, "sasa": 1, "rg": 1, "imported": 0}
        if spec["kind"] not in counts or len(spec["groups"]) != counts[spec["kind"]]:
            raise ValueError("Choose an observable and fill its residue groups.")
        if spec["kind"] == "contacts":
            spec["cutoff"] = numeric(spec, "cutoff", float, 0.1, 50)
        if spec["kind"] == "sasa":
            spec["workers"] = requested_cpu_workers(spec)
        return jsonify(observable_values(model, settings, spec))
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/conformations/associations")
def conformation_associations():
    try:
        data = request.get_json()
        model, settings = conformation_run(data["run"])
        spec = data["association"]
        if spec["feature"] not in {"distance", "contacts", "displacement", "sasa"}:
            raise ValueError("Choose a supported residue feature.")
        if spec["feature"] == "contacts":
            spec["cutoff"] = numeric(spec, "cutoff", float, 0.1, 50)
        if spec["feature"] == "sasa":
            spec["sasa_max_frames"] = numeric(spec, "sasa_max_frames", int, 20, MAX_TRAJECTORY_FRAMES)
            spec["workers"] = requested_cpu_workers(spec)
        return jsonify(residue_associations(model, settings, spec))
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        return jsonify(error=str(error)), 400


@app.post("/api/conformations/cluster-tests")
def conformation_cluster_tests():
    try:
        data = request.get_json()
        groups = data["groups"]
        max_groups = MAX_TRAJECTORY_FRAMES // 2
        if not isinstance(groups, list) or not 2 <= len(groups) <= max_groups:
            raise ValueError("Supply summary statistics for at least two assigned clusters.")
        normalized = []
        for group in groups:
            normalized.append(dict(id=numeric(group, "id", int, 1, max_groups),
                                   count=numeric(group, "count", int, 1, MAX_TRAJECTORY_FRAMES),
                                   mean=numeric(group, "mean", float, -1e150, 1e150),
                                   sd=numeric(group, "sd", float, 0, 1e150)))
        if len({group["id"] for group in normalized}) != len(normalized):
            raise ValueError("Cluster IDs must be unique.")
        anchor = data.get("anchor")
        if anchor is not None and anchor not in {group["id"] for group in normalized}:
            raise ValueError("Choose an assigned cluster for comparison.")
        if len(normalized) > 24 and anchor is None:
            raise ValueError("Choose one reference cluster to compare with the others.")
        return jsonify(pairs=welch_cluster_pairs(normalized, anchor))
    except (ValueError, TypeError, KeyError) as error:
        return jsonify(error=str(error)), 400


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--server", action="store_true", help="Serve the app on loopback without opening a window.")
    mode.add_argument("--desktop", action="store_true", help="Open a dedicated desktop window (default).")
    parser.add_argument("--port", type=int, help="Run in server mode on this port (default: 8765).")
    parser.add_argument("--browser", help="Chromium or Chrome executable for desktop mode.")
    args = parser.parse_args()
    if args.desktop and args.port is not None:
        parser.error("--port is only used in server mode")
    if args.server or args.port is not None:
        if args.browser:
            parser.error("--browser is only used in desktop mode")
        app.run(host="127.0.0.1", port=args.port if args.port is not None else 8765, debug=False)
    else:
        from desktop import launch

        try:
            launch(app, args.browser)
        except (OSError, RuntimeError) as error:
            parser.exit(1, f"Desktop launch failed: {error}\n")
