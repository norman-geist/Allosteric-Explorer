"""Structure preparation, fpocket integration, and ensemble communication."""
import base64
from progress import report as report_progress
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from itertools import islice
from multiprocessing import get_context
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import networkx as nx
import numpy as np
from scipy.sparse.linalg import svds
from scipy.spatial import cKDTree
from scipy.spatial.distance import cdist

MAX_TRAJECTORY_FRAMES = 10_000

VDW_RADII = {"C": 1.70, "N": 1.55, "O": 1.52, "S": 1.80, "P": 1.80, "SE": 1.90,
             "F": 1.47, "CL": 1.75, "BR": 1.85, "I": 1.98}

STANDARD = set("ALA ARG ASN ASP CYS GLU GLN GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL HID HIE HIP HSD HSE HSP CYX MSE".split())


# Recognized monatomic species only; do not interpret ligands/water as ions.
ION_NAMES = set("ZN ZN2 CA CAL MG MG2 MN MN2 FE FE2 FE3 CU CU1 CU2 CO CO2 NI NI2 NA SOD K POT CL CLA CD HG SR CS BA LI RB F BR I IOD".split())


def pdb_residue_key(line):
    return line[21].strip(), line[72:76].strip(), int(line[22:26]), line[26].strip()


def parse_structure(content, name):
    """Keep one protein model plus recognized ions, preserving residue identity."""
    atoms, residues, identities, ion_lines = [], [], {}, []
    for line in content.splitlines():
        if line.startswith("ENDMDL") and atoms:
            break
        if not line.startswith(("ATOM  ", "HETATM")):
            continue
        resname = line[17:20].strip()
        if line[16:17] not in (" ", "A"):
            continue
        if resname not in STANDARD:
            if resname in ION_NAMES and len(line) >= 54:
                xyz = [float(line[start:start + 8]) for start in (30, 38, 46)]
                if not np.isfinite(xyz).all():
                    raise ValueError("Ion coordinates must be finite.")
                ion_lines.append(line)
            continue
        if len(line) < 54:
            raise ValueError("Found a truncated protein atom record.")
        identity = pdb_residue_key(line)
        chain, segid, resid, icode = identity
        xyz = [float(line[start:start + 8]) for start in (30, 38, 46)]
        if not np.isfinite(xyz).all():
            raise ValueError("Protein coordinates must be finite.")
        if identity not in identities:
            number = len(residues) + 1
            identities[identity] = number
            residues.append(dict(id=number, chain=chain, segid=segid, resid=resid, icode=icode,
                                 name=resname, ca=None))
        number = identities[identity]
        residue = residues[number - 1]
        if residue["name"] != resname:
            raise ValueError("Ambiguous residue identity. Give each chain a unique PDB chain ID.")
        if line[12:16].strip() == "CA":
            if residue["ca"] is not None:
                raise ValueError("Duplicate Cα at one residue identity. Check chain IDs and alternate locations.")
            residue["ca"] = xyz
        atoms.append((line, number))
    if len(residues) < 4 or len(residues) > 9999:
        raise ValueError("The PDB must contain 4–9999 supported amino-acid residues.")
    if len(atoms) > 99999:
        raise ValueError("Use a PDB with at most 99,999 protein atoms.")
    view, detector = [], []
    for serial, (line, number) in enumerate(atoms, 1):
        atom = f"ATOM  {serial:5d}" + line[11:16] + " " + line[17:]
        view.append(atom)
        detector.append(atom[:22] + f"{number:4d} " + atom[27:])
    # Preserve ion identity and coordinates for inspection, outside the protein detector.
    ions = []
    for line in ion_lines:
        chain, segid, resid, icode = pdb_residue_key(line)
        identity = (chain, segid, resid, icode, line[12:16].strip(), line[17:20].strip())
        if any(ion["identity"] == identity for ion in ions):
            continue
        if len(view) >= 99999:
            raise ValueError("Use a PDB with at most 99,999 retained atoms.")
        ions.append(dict(identity=identity, name=line[17:20].strip(), chain=chain, segid=segid,
                         resid=resid, icode=icode, xyz=[float(line[i:i+8]) for i in (30, 38, 46)]))
        view.append(f"HETATM{len(view)+1:5d}" + line[11:])
    for ion in ions:
        ion.pop("identity")
    return dict(name=name, pdb="\n".join(view) + "\nEND\n", residues=residues, ions=ions), "\n".join(detector) + "\nEND\n"


def fpocket_executable():
    candidate = Path(sys.prefix) / ("Scripts" if sys.platform == "win32" else "bin") / "fpocket"
    return shutil.which(str(candidate)) or shutil.which("fpocket")


def read_fpocket(folder, count):
    descriptors = {}
    current = None
    info = folder / "protein_info.txt"
    if info.exists():
        for line in info.read_text().splitlines():
            match = re.match(r"\s*Pocket\s+(\d+)\s*:", line)
            if match:
                current = descriptors.setdefault(int(match[1]), {})
            elif current is not None and ":" in line:
                key, value = line.split(":", 1)
                try:
                    number = float(value)
                except ValueError:
                    continue
                if np.isfinite(number):
                    current[key.strip()] = number
    records = []
    for file in (folder / "pockets").glob("pocket*_atm.pdb"):
        match = re.fullmatch(r"pocket(\d+)_atm\.pdb", file.name)
        if not match:
            continue
        pid = int(match[1])
        nodes = {int(line[22:26]) for line in file.read_text().splitlines()
                 if line.startswith(("ATOM  ", "HETATM"))}
        if any(node < 1 or node > count for node in nodes):
            raise ValueError(f"Pocket {pid} could not be mapped to the input structure.")
        if not nodes:
            continue
        vertices = folder / "pockets" / f"pocket{pid}_vert.pqr"
        centers = []
        if vertices.exists():
            for line in vertices.read_text().splitlines():
                if line.startswith(("ATOM  ", "HETATM")):
                    point = [float(line[i:i + 8]) for i in (30, 38, 46)]
                    if np.isfinite(point).all():
                        centers.append(point)
        fields = descriptors.get(pid, {})
        records.append(dict(id=pid, residues=sorted(nodes), centers=centers,
                            score=fields.get("Score"), druggability=fields.get("Druggability Score"),
                            volume=fields.get("Volume")))
    return sorted(records, key=lambda record: record["id"])


def detect_pockets(detector, count, executable, options=()):
    if not executable:
        raise ValueError("fpocket was not found. Install it in the app environment and restart the app.")
    report_progress("Running fpocket external detector")
    with TemporaryDirectory(prefix="allosteric_") as directory:
        work = Path(directory)
        (work / "protein.pdb").write_text(detector)
        try:
            run = subprocess.run([str(Path(executable).resolve()), "-f", "protein.pdb", *options],
                                 cwd=work, capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired as error:
            raise ValueError("fpocket exceeded the three-minute runtime limit.") from error
        if run.returncode:
            tail = (run.stderr.strip() or run.stdout.strip())[-500:]
            raise ValueError(f"fpocket exited with code {run.returncode}. {tail}")
        return read_fpocket(work / "protein_out", count)


def align_frames(coordinates, reference, fit):
    """Kabsch superposition on the selected Cα fit core."""
    if len(fit) < 3:
        raise ValueError("The fit core needs at least three non-collinear Cα atoms.")
    core = reference[fit] - reference[fit].mean(0)
    if np.linalg.matrix_rank(core) < 2:
        raise ValueError("The fit core needs at least three non-collinear Cα atoms.")
    moving = coordinates[:, fit]
    centers = moving.mean(axis=1, keepdims=True)
    u, _, vt = np.linalg.svd((moving - centers).transpose(0, 2, 1) @ core)
    u[:, :, -1] *= np.linalg.det(u @ vt)[:, None]
    return (coordinates - centers) @ (u @ vt) + reference[fit].mean(0)


def coupling_matrix(aligned, counts, method):
    """Uniform-weight DCC or Pearson correlation of per-residue contact counts."""
    values = counts if method == "contacts" else aligned
    values = values - values.mean(axis=0)
    if method == "contacts":
        cov = values.T @ values
    else:
        cov = sum(component.T @ component for component in values.transpose(2, 0, 1))
    deviation = np.sqrt(np.maximum(np.diag(cov), 0))
    denominator = np.outer(deviation, deviation)
    return np.clip(np.divide(cov, denominator, out=np.zeros_like(cov), where=denominator > 1e-12), -1, 1)


def topology_key(atom):
    return int(atom.resid), str(getattr(atom.residue, "icode", "")).strip(), atom.resname


def match_ca_atoms(atoms, residues):
    """Return topology Cα atoms in reference order, using chain or segment identity."""
    reference = [(r["resid"], r["icode"], r["name"]) for r in residues]
    selected = [topology_key(atom) for atom in atoms]
    if len(reference) != len(selected):
        raise ValueError(
            f"Cα count differs: PDB has {len(reference)}, topology selection has {len(selected)}. "
            "Select the topology chains or segments present in the PDB."
        )

    ref_chains = [r["chain"] for r in residues]
    top_chains = [str(chain).strip() for chain in atoms.chainIDs] if hasattr(atoms, "chainIDs") else [""] * len(atoms)
    ref_segments = [r.get("segid", "") for r in residues]
    top_segments = [str(segment).strip() for segment in atoms.segids]

    def match_keys(ref_keys, top_keys):
        lookup = {key: i for i, key in enumerate(top_keys)}
        if len(lookup) == len(top_keys) and len(set(ref_keys)) == len(ref_keys) and lookup.keys() == set(ref_keys):
            return atoms[[lookup[key] for key in ref_keys]]
        raise ValueError(
            "Cα residue identities differ or are ambiguous between the PDB and topology. "
            "Check residue numbers, names, insertion codes, and chain or segment IDs in the topology selection. "
            "For identical chains in a PSF, include the matching PSF segment IDs in the PDB."
        )

    if all(ref_chains) and all(top_chains):
        ref_keys = list(zip(ref_chains, reference))
        top_keys = list(zip(top_chains, selected))
        if len(set(ref_keys)) == len(ref_keys) and len(set(top_keys)) == len(top_keys):
            return match_keys(ref_keys, top_keys)
        if set(ref_chains) != set(top_chains):
            return match_keys(ref_keys, top_keys)
        if all(ref_segments) and set(ref_segments) == set(top_segments):
            return match_keys(list(zip(ref_segments, ref_keys)), list(zip(top_segments, top_keys)))
    if all(ref_segments) and set(ref_segments) == set(top_segments):
        return match_keys(list(zip(ref_segments, reference)), list(zip(top_segments, selected)))
    if all(ref_chains) and set(ref_chains) == set(top_segments) and not any(top_chains):
        return match_keys(list(zip(ref_chains, reference)), list(zip(top_segments, selected)))

    if len(set(reference)) == len(reference) and len(set(selected)) == len(selected):
        return match_keys(reference, selected)

    # Some PSFs lack chain IDs and the reference has no matching segment tags.
    # Infer correspondence only if each group's full residue signature is unique.
    def group_signatures(keys, groups):
        grouped = defaultdict(list)
        for group, key in zip(groups, keys):
            grouped[group].append(key)
        signatures = {group: tuple(sorted(values)) for group, values in grouped.items()}
        return [(signatures[group], key) for group, key in zip(groups, keys)]

    ref_groups = list(zip(ref_chains, ref_segments))
    top_groups = [(chain, segment) for chain, segment in zip(top_chains, top_segments)]
    return match_keys(group_signatures(reference, ref_groups), group_signatures(selected, top_groups))


def cpu_workers(requested, frame_count):
    available = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 1)
    return min(requested, max(1, available), frame_count)


def snapshot_sasa(universe, atoms, selection, frames, points, *, workers=1):
    """Mean Shrake–Rupley area per mapped residue."""
    sums = np.zeros(len(atoms))
    for areas in residue_sasa_frames(universe, atoms, selection, frames, points, workers=workers):
        sums += areas
    return sums / len(frames)


def sasa_frame_areas(xyz, *, radii, mapping, measured, sphere, residue_count):
    areas = np.zeros(residue_count)
    tree = cKDTree(xyz)
    neighbors = tree.query_ball_point(xyz[measured], radii[measured] + radii.max())
    for i, near in zip(measured, neighbors):
        near = np.asarray(near, dtype=int)
        near = near[near != i]
        dots = xyz[i] + radii[i] * sphere
        exposed = np.all(cdist(dots, xyz[near], metric="sqeuclidean") >= radii[near]**2, axis=1)
        areas[mapping[i]] += 4 * np.pi * radii[i]**2 * exposed.mean()
    return areas


def residue_sasa_frames(universe, atoms, selection, frames, points, *, workers=1):
    report_progress("Computing residue SASA", 0, len(frames))
    for count, areas in enumerate(_residue_sasa_frames(universe, atoms, selection, frames, points, workers=workers), 1):
        report_progress("Computing residue SASA", count, len(frames))
        yield areas


def _residue_sasa_frames(universe, atoms, selection, frames, points, *, workers=1):
    """Yield heavy-atom Shrake–Rupley areas for individual trajectory frames."""
    from MDAnalysis.guesser.default_guesser import DefaultGuesser

    selected = universe.select_atoms(selection)
    shielding = selected | atoms.residues.atoms
    if hasattr(shielding, "altLocs"):
        shielding = shielding[np.isin(shielding.altLocs, ["", "A"])]
    elements = (shielding.elements if hasattr(shielding, "elements")
                else DefaultGuesser(None).guess_types(shielding.names))
    elements = np.char.upper(np.char.strip(np.asarray(elements, dtype="U4")))
    if np.any(elements == ""):
        elements[elements == ""] = DefaultGuesser(None).guess_types(shielding.names[elements == ""])
    heavy = ~np.isin(elements, ("H", "D"))
    shielding, elements = shielding[heavy], elements[heavy]
    missing = set(elements) - VDW_RADII.keys()
    if missing:
        raise ValueError(f"SASA radii are unavailable for {', '.join(sorted(missing))}. Refine the shielding selection.")
    radii = np.array([VDW_RADII[e] + 1.4 for e in elements])
    lookup = {resindex: i for i, resindex in enumerate(atoms.resindices)}
    mapping = np.array([lookup.get(r, -1) for r in shielding.resindices])
    measured = np.flatnonzero(mapping >= 0)
    z = 1 - 2 * (np.arange(points) + .5) / points
    phi = np.arange(points) * np.pi * (3 - np.sqrt(5))
    sphere = np.column_stack((np.sqrt(1 - z*z) * np.cos(phi),
                              np.sqrt(1 - z*z) * np.sin(phi), z))
    def positions():
        for frame in frames:
            universe.trajectory[int(frame)]
            yield shielding.positions.astype(float, copy=True)

    calculate = partial(sasa_frame_areas, radii=radii, mapping=mapping,
                        measured=measured, sphere=sphere, residue_count=len(atoms))
    count = cpu_workers(workers, len(frames))
    if sys.platform == "win32":
        count = min(count, 61)
    if count <= 1:
        yield from map(calculate, positions())
        return

    # Read frames in the parent and keep only a bounded batch of coordinate copies.
    coordinates = positions()
    with ProcessPoolExecutor(max_workers=count, mp_context=get_context("spawn")) as pool:
        while batch := list(islice(coordinates, 2 * count)):
            yield from pool.map(calculate, batch)


def open_trajectory(settings):
    import MDAnalysis as mda

    topology = Path(settings["topology"]).expanduser()
    trajectory = Path(settings["trajectory"]).expanduser()
    if not topology.is_file() or not trajectory.is_file():
        raise ValueError("Enter valid local paths to the topology and trajectory.")
    return mda.Universe(str(topology), str(trajectory))


def trajectory_inputs(structure, settings, *, min_frames=20, max_explicit_frames=MAX_TRAJECTORY_FRAMES):
    universe = open_trajectory(settings)
    selection = settings.get("selection", "").strip() or "protein"
    atoms = universe.select_atoms(f"({selection}) and name CA")
    if hasattr(atoms, "altLocs"):
        atoms = atoms[np.isin(atoms.altLocs, ["", "A"])]
    residues = [r for r in structure["residues"] if r["ca"] is not None]
    atoms = match_ca_atoms(atoms, residues)
    stride = settings["stride"]
    maximum = settings["max_frames"]
    explicit = settings.get("frame_indices")
    if explicit is None:
        indices = np.arange(0, len(universe.trajectory), stride, dtype=int)
        if len(indices) > maximum:
            indices = indices[np.linspace(0, len(indices) - 1, maximum).astype(int)]
    else:
        if not isinstance(explicit, list) or len(explicit) > max_explicit_frames:
            raise ValueError(f"Choose at most {max_explicit_frames:,} explicit trajectory frames.")
        if (any(type(index) is not int or not 0 <= index < len(universe.trajectory) for index in explicit)
                or explicit != sorted(set(explicit))):
            raise ValueError("Selected frames must be unique, sorted trajectory indices.")
        indices = np.asarray(explicit, dtype=int)
    if len(indices) < min_frames:
        raise ValueError(f"At least {min_frames} retained frame(s) are required. Reduce the stride or use a longer trajectory.")
    return universe, atoms, residues, indices


def ca_coordinates(atoms, indices):
    coordinates = np.empty((len(indices), len(atoms), 3))
    for i, index in enumerate(indices):
        if i % 10 == 0: report_progress("Reading retained trajectory frames", i, len(indices))
        atoms.universe.trajectory[int(index)]
        coordinates[i] = atoms.positions
    if not np.isfinite(coordinates).all():
        raise ValueError("Trajectory coordinates must be finite.")
    return coordinates


def load_frames(structure, settings):
    universe, atoms, residues, indices = trajectory_inputs(structure, settings)
    if len(atoms) > 1800:
        raise ValueError("Communication is limited to 1,800 Cα nodes. Use a smaller reference and matching topology selection.")
    frames = ca_coordinates(atoms, indices)
    sasa, sasa_frames = None, []
    if settings.get("candidate_filter", "all") in ("surface", "buried"):
        count = min(len(indices), settings.get("sasa_snapshots", 12))
        sasa_frames = indices[np.linspace(0, len(indices) - 1, count).astype(int)]
        sasa = snapshot_sasa(universe, atoms, settings.get("shielding", "protein") or "protein",
                             sasa_frames, settings.get("sasa_points", 120), workers=settings.get("workers", 1))
    return residues, frames, indices, sasa, list(map(int, sasa_frames))


def alternate_routes(graph, sources, target, limit=5):
    """Enumerate lowest-cost loopless routes from a region to one endpoint."""
    start = 0  # Structure node IDs start at 1.
    if target not in graph or target in sources:
        raise ValueError("Choose a target outside Region A.")
    network = nx.subgraph_view(
        graph.to_directed(as_view=True),
        filter_edge=lambda u, v: v != start and (u == start or v not in sources),
    )
    try:
        paths = list(islice(nx.shortest_simple_paths(network, start, target, weight="weight"), limit))
    except nx.NetworkXNoPath:
        return []
    routes = []
    for _, *path in paths:
        edges = [graph[u][v] for u, v in zip(path, path[1:])]
        routes.append(dict(path=path, cost=sum(edge["weight"] for edge in edges),
                           edges=[dict(correlation=e["correlation"], occupancy=e["occupancy"])
                                  for e in edges]))
    return routes


def analyze(structure, pockets, settings, route_context=None):
    report_progress("Reading and mapping retained trajectory frames")
    residues, frames, frame_indices, sasa, sasa_frames = load_frames(structure, settings)
    index = {r["id"]: i for i, r in enumerate(residues)}

    def region(key):
        requested = set(settings[key])
        if not requested <= index.keys():
            raise ValueError(f"{key.upper()} includes residues without a matched Cα.")
        return [index[node] for node in sorted(requested)]

    a, b, functional = region("a"), region("b"), region("functional")
    if not a:
        raise ValueError("Choose Region A to run communication analysis.")
    if set(a) & set(b):
        raise ValueError("Regions A and B overlap. Choose disjoint endpoints.")
    if not np.any(np.ptp(frames, axis=0) > 1e-7):
        raise ValueError("The retained trajectory frames are identical.")
    reference = np.asarray([r["ca"] for r in residues], dtype=float)
    fit = np.flatnonzero(~np.isin(np.arange(len(residues)), a))
    report_progress("Aligning trajectory frames")
    aligned = align_frames(frames, reference, fit)
    if np.max(np.std(aligned, axis=0)) < 1e-6:
        raise ValueError("The trajectory has no internal motion after alignment.")
    occupancy = np.zeros((len(residues), len(residues)), dtype=float)
    counts = np.empty((len(frames), len(residues)))
    distance = np.zeros(len(residues))
    for step, frame in enumerate(frames):
        if step % 10 == 0: report_progress("Computing contact occupancy", step, len(frames))
        pair_distances = cdist(frame, frame)
        distance += pair_distances[:, a].min(axis=1)
        contact = pair_distances < settings["cutoff"]
        np.fill_diagonal(contact, False)
        occupancy += contact
        counts[step] = contact.sum(axis=1)
    occupancy /= len(frames)
    distance /= len(frames)
    report_progress("Computing correlation matrix and block consistency")
    corr = coupling_matrix(aligned, counts, settings["method"])
    score = np.abs(corr[:, a]).mean(axis=1)
    signed = corr[:, a].mean(axis=1)
    blocks = np.array_split(np.arange(len(frames)), 2)
    anchor = functional or a
    block_coupling, halves = [], []
    for part in blocks:
        matrix = coupling_matrix(aligned[part], counts[part], settings["method"])
        halves.append(np.abs(matrix[:, a]).mean(axis=1))
        block_coupling.append(np.abs(matrix[:, anchor]).mean(axis=1))
    graph = nx.Graph()
    graph.add_nodes_from(range(len(residues)))
    eligible = np.triu((occupancy >= settings["occupancy"]) &
                       (np.abs(corr) >= settings["coupling"]) & (occupancy > 0) &
                       (np.abs(corr) > 0), 1)
    for i, j in zip(*np.where(eligible)):
        strength = np.clip(abs(corr[i, j]) * occupancy[i, j], 1e-12, 1 - 1e-9)
        graph.add_edge(int(i), int(j), weight=float(-np.log(strength)),
                       correlation=float(corr[i, j]), occupancy=float(occupancy[i, j]))
    report_progress("Solving communication paths and ranking residues")
    costs, paths = nx.multi_source_dijkstra(graph, a)
    candidates = np.ones(len(residues), dtype=bool)
    candidates[a] = False
    if b:
        candidates &= np.isin(np.arange(len(residues)), b)
    else:
        candidates &= distance >= settings.get("min_distance", 0)
        if sasa is not None:
            surface = sasa >= settings.get("sasa_threshold", 25)
            candidates &= surface if settings["candidate_filter"] == "surface" else ~surface
        if settings.get("reachable_only", False):
            candidates &= np.isin(np.arange(len(residues)), list(paths))

    profile = [
        dict(id=r["id"], coupling=float(score[i]), signed=float(signed[i]),
             distance=float(distance[i]), sasa=float(sasa[i]) if sasa is not None else None,
             halves=[float(half[i]) for half in halves], eligible=bool(candidates[i]),
             connected=i in paths)
        for i, r in enumerate(residues)
    ]
    endpoints = sorted(np.flatnonzero(candidates), key=lambda i: -score[i])
    rows = []
    for i in endpoints:
        route = paths.get(i, [])
        edges = [dict(correlation=float(corr[j, k]), occupancy=float(occupancy[j, k]))
                 for j, k in zip(route, route[1:])]
        rows.append(dict(**profile[i], cost=costs.get(i),
                         path=[residues[j]["id"] for j in route], edges=edges))

    centered = aligned.reshape(len(frames), -1).copy()
    centered -= centered.mean(axis=0)
    total = np.einsum("ij,ij->", centered, centered)
    u, singular, _ = svds(centered, k=2, random_state=0)
    pc = (u * singular)[:, ::-1]
    fractions = singular[::-1]**2 / total
    pocket_ranking = []
    for pocket in pockets:
        nodes = sorted({index[node] for node in pocket["residues"] if node in index} - set(anchor))
        if nodes:
            values = corr[np.ix_(nodes, anchor)]
            abs_mean = np.abs(values).mean(axis=1)
            signed_mean = values.mean(axis=1)
            lining = [
                dict(id=residues[node]["id"], coupling=float(score), signed=float(signed),
                     blocks=[float(block[node]) for block in block_coupling])
                for node, score, signed in zip(nodes, abs_mean, signed_mean)
            ]
            lining.sort(key=lambda row: -row["coupling"])
            pocket_ranking.append(dict(
                id=pocket["id"], coupling=float(abs_mean.mean()), residues=len(nodes),
                lining=lining, blocks=[float(block[nodes].mean()) for block in block_coupling],
            ))
    if route_context is not None:
        network = nx.relabel_nodes(graph, {i: residue["id"] for i, residue in enumerate(residues)})
        sources = frozenset(residues[i]["id"] for i in a)
        network.add_weighted_edges_from((0, node, 0.0) for node in sources)
        route_context.update(graph=network, sources=sources,
                             targets=frozenset(residues[i]["id"] for i in endpoints if i in paths))
    return dict(frames=len(frames), nodes=len(residues), edges=graph.number_of_edges(),
                rows=rows, profile=profile, settings=settings, sasa_frames=sasa_frames,
                frame_indices=frame_indices.tolist(), pc=pc.tolist(), pc_variance=fractions.tolist(),
                correlation=base64.b64encode(corr.astype("<f4").tobytes()).decode("ascii"),
                pockets=sorted(pocket_ranking, key=lambda p: -p["coupling"]),
                pocket_blocks=[dict(first=int(frame_indices[part[0]]), last=int(frame_indices[part[-1]]),
                                    count=len(part)) for part in blocks])
