"""Conformational embeddings, cluster selections, and trajectory observables."""
import csv
from progress import report as report_progress
import io
from itertools import combinations
from pathlib import Path

import numpy as np
from scipy.cluster.hierarchy import cut_tree, linkage
from scipy.cluster.vq import ClusterError, kmeans2
from scipy.sparse.linalg import svds
from scipy.spatial import cKDTree
from scipy.spatial.distance import cdist
from scipy.stats import rankdata, ttest_ind_from_stats

from engine import align_frames, ca_coordinates, pdb_residue_key, residue_sasa_frames, trajectory_inputs


def node_positions(residues, requested, name):
    lookup = {residue["id"]: index for index, residue in enumerate(residues)}
    if not requested or not set(requested) <= lookup.keys():
        raise ValueError(f"{name} must contain matched Cα residues.")
    return np.array([lookup[node] for node in sorted(set(requested))])


def backbone_indices(atoms):
    indices = np.full((len(atoms), 3), -1, dtype=int)
    for i, residue in enumerate(atoms.residues):
        for j, name in enumerate(("N", "CA", "C")):
            group = residue.atoms
            selected = group[group.names == name]
            if hasattr(selected, "altLocs"):
                selected = selected[np.isin(selected.altLocs, ["", "A"])]
            if len(selected) == 1:
                indices[i, j] = selected.indices[0]
    return indices


def dihedral_features(universe, atoms, residues, frames, focus):
    from MDAnalysis.lib.distances import calc_dihedrals

    backbone = backbone_indices(atoms)
    universe.trajectory[int(frames[0])]
    coords = universe.atoms.positions
    allowed = set(focus)
    quartets = []
    for left, right in zip(range(len(atoms) - 1), range(1, len(atoms))):
        if (atoms[left].segid != atoms[right].segid
                or residues[left]["chain"] != residues[right]["chain"]
                or atoms[right].resindex != atoms[left].resindex + 1):
            continue
        nl, cal, cl = backbone[left]
        nr, car, cr = backbone[right]
        if cl < 0 or nr < 0 or np.linalg.norm(coords[cl] - coords[nr]) > 2.0:
            continue
        if left in allowed and min(nl, cal) >= 0:
            quartets.append([nl, cal, cl, nr])
        if right in allowed and min(car, cr) >= 0:
            quartets.append([cl, nr, car, cr])
    if not quartets:
        raise ValueError("No continuous backbone φ/ψ angles found in the PCA residues.")
    quartets = np.array(quartets).T
    angles = []
    for frame_index, frame in enumerate(frames):
        if frame_index % 10 == 0: report_progress("Extracting trajectory features", frame_index, len(frames))
        universe.trajectory[int(frame)]
        xyz = universe.atoms.positions
        angles.append(calc_dihedrals(*(xyz[indices] for indices in quartets)))
    angles = np.asarray(angles)
    valid = np.isfinite(angles).all(axis=0)
    if not valid.any():
        raise ValueError("All selected backbone angles are undefined in at least one retained frame.")
    angles = angles[:, valid]
    return np.column_stack((np.sin(angles), np.cos(angles))), int(valid.sum())


def cluster_projection(points, settings):
    method = settings.get("clustering", "kmeans")
    if method == "dbscan":
        from sklearn.cluster import DBSCAN

        scale = np.sqrt(np.square(points).sum(axis=1).mean())
        if settings["min_samples"] > len(points):
            raise ValueError("DBSCAN minimum samples exceeds the retained frame count.")
        return DBSCAN(eps=settings["eps"], min_samples=settings["min_samples"]).fit_predict(points / scale)

    count = settings["clusters"]
    if np.unique(np.round(points, decimals=8), axis=0).shape[0] < count:
        raise ValueError("Too few distinct projections for this cluster count.")
    if method == "ward":
        return cut_tree(linkage(points, method="ward"), n_clusters=[count]).ravel()
    best = None
    for seed in range(6):
        try:
            centers, labels = kmeans2(points, count, iter=60, minit="++", missing="raise", seed=seed)
        except ClusterError:
            continue
        error = np.square(points - centers[labels]).sum()
        if best is None or error < best[0]:
            best = error, labels
    if best is None:
        raise ValueError("The requested clusters could not be fitted. Try fewer clusters.")
    return best[1]


def contact_contact_features(universe, frames, selections):
    """Build strided atom-pair distances with per-frame mean normalization."""
    from MDAnalysis.exceptions import SelectionError

    groups = []
    for i, selection in enumerate(selections, 1):
        try:
            groups.append(universe.select_atoms(selection))
        except SelectionError as error:
            raise ValueError(f"Invalid ccPCA group {i} selection: {error}") from error
    sizes = [len(group) for group in groups]
    pair_count = min(sizes)
    if pair_count < 2:
        raise ValueError("Each ccPCA selection must match at least two atoms.")
    strides = [size // pair_count for size in sizes]
    first, second = (group[::stride][:pair_count] for group, stride in zip(groups, strides))
    features = np.empty((len(frames), pair_count))
    for i, frame in enumerate(frames):
        if i % 10 == 0: report_progress("Extracting contact-contact features", i, len(frames))
        universe.trajectory[int(frame)]
        distances = np.linalg.norm(first.positions - second.positions, axis=1)
        mean = distances.mean()
        if not np.isfinite(mean) or mean <= 0:
            raise ValueError(f"ccPCA requires a positive, finite mean paired distance in frame {frame}.")
        features[i] = distances / mean
    return features, dict(pair_count=pair_count, group_sizes=sizes, strides=strides)


def embedding(structure, settings):
    report_progress("Mapping trajectory and extracting PCA features")
    universe, atoms, residues, frames = trajectory_inputs(structure, settings)
    if len(atoms) > 2500:
        raise ValueError("Conformations is limited to 2,500 Cα nodes. Use a smaller reference and matching topology selection.")
    all_nodes = [r["id"] for r in residues]
    fit = node_positions(residues, settings.get("fit") or all_nodes, "Alignment selection")
    reference = np.array([r["ca"] for r in residues], dtype=float)
    if len(fit) < 3 or np.linalg.matrix_rank(reference[fit] - reference[fit].mean(0)) < 2:
        raise ValueError("Alignment requires three non-collinear Cα atoms.")
    basis = settings["basis"]
    angle_count, contact_pairs = None, None
    if basis == "ccpca":
        features, contact_pairs = contact_contact_features(universe, frames, settings["ccpca_selections"])
    else:
        focus = node_positions(residues, settings.get("focus") or all_nodes, "PCA selection")
        if basis == "cartesian":
            aligned = align_frames(ca_coordinates(atoms, frames), reference, fit)
            features = aligned[:, focus].reshape(len(frames), -1)
        else:
            features, angle_count = dihedral_features(universe, atoms, residues, frames, focus)
    report_progress("Solving principal components")
    features = features - features.mean(axis=0)
    total = np.square(features).sum()
    if not np.isfinite(total) or total < 1e-12:
        raise ValueError("The selected features have no usable variation.")
    count = min(settings["components"], min(features.shape))
    if count < min(features.shape):
        u, s, _ = svds(features, k=count, random_state=0)
        u, s = u[:, ::-1], s[::-1]
    else:
        u, s, _ = np.linalg.svd(features, full_matrices=False)
    if len(s) < 2:
        raise ValueError("At least two PCA features are needed.")
    projection = u * s
    report_progress("Clustering projected frames")
    labels = cluster_projection(projection, settings)
    clusters = []
    for cluster_id, raw_label in enumerate(sorted(set(labels) - {-1}, key=lambda i: (-np.sum(labels == i), int(i))), 1):
        members = np.flatnonzero(labels == raw_label)
        centered = projection[members] - projection[members].mean(0)
        representative = int(members[np.argmin(np.square(centered).sum(1))])
        clusters.append(dict(id=cluster_id, count=len(members), representative=int(frames[representative]),
                             frames=frames[members].tolist()))
    result = dict(projection=projection.tolist(), variance=(s**2 / total).tolist(),
                  clusters=clusters, noise=frames[labels == -1].tolist(), frames=frames.tolist(),
                  angles=angle_count, contact_pairs=contact_pairs, settings=settings)
    return result


def observable_values(structure, settings, spec):
    report_progress("Computing trajectory observable")
    universe, atoms, residues, frames = trajectory_inputs(structure, settings)
    kind = spec["kind"]
    if kind == "imported":
        path = Path(spec["csv"]).expanduser()
        if not path.is_file() or path.stat().st_size > 24 * 1024 * 1024:
            raise ValueError("Choose a local CSV of at most 24 MB.")
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if not {"frame", "value"} <= set(reader.fieldnames or []):
                raise ValueError("CSV requires frame,value headers and zero-based trajectory frame indices.")
            values = {}
            for row in reader:
                frame, value = int(row["frame"]), float(row["value"])
                if frame < 0 or frame >= len(universe.trajectory) or frame in values or not np.isfinite(value):
                    raise ValueError("CSV must use unique in-range frame indices and finite values.")
                values[frame] = value
        if any(frame not in values for frame in frames):
            raise ValueError("CSV is missing values for retained trajectory frames.")
        return dict(values=[values[frame] for frame in frames], unit="CSV units", circular=False)

    groups = [node_positions(residues, nodes, f"Group {i + 1}") for i, nodes in enumerate(spec["groups"])]
    if kind in {"minimum", "center", "contacts"} and np.intersect1d(*groups).size:
        raise ValueError("Choose non-overlapping groups for distance or contact observables.")
    if kind == "sasa":
        values = [float(areas.sum()) for areas in
                  residue_sasa_frames(universe, atoms[groups[0]], "protein", frames, 120, workers=spec.get("workers", 1))]
        return dict(values=values, unit="Å²", circular=False)
    if kind == "rg":
        group = atoms[groups[0]].residues.atoms
        if hasattr(group, "altLocs"):
            group = group[np.isin(group.altLocs, ["", "A"])]
        masses = np.asarray(getattr(group, "masses", []), dtype=float)
        if not len(masses) or not np.isfinite(masses).all() or np.any(masses <= 0):
            raise ValueError("Radius of gyration requires positive atom masses for the selected residues.")
        weights = masses / masses.sum()
        values = []
        for frame in frames:
            universe.trajectory[int(frame)]
            xyz = group.positions.astype(float)
            centered = xyz - weights @ xyz
            values.append(float(np.sqrt(weights @ np.sum(centered**2, axis=1))))
        if not np.isfinite(values).all():
            raise ValueError("Radius of gyration is undefined in one or more retained frames.")
        return dict(values=values, unit="Å", circular=False)
    if kind == "rmsd":
        reference = np.array([r["ca"] for r in residues], dtype=float)
        fit = node_positions(residues, settings.get("fit") or [r["id"] for r in residues], "Alignment selection")
        aligned = align_frames(ca_coordinates(atoms, frames), reference, fit)
        values = np.sqrt(np.square(aligned[:, groups[0]] - reference[groups[0]]).sum(2).mean(1))
        return dict(values=values.tolist(), unit="Å", circular=False)

    from MDAnalysis.guesser.default_guesser import DefaultGuesser
    from MDAnalysis.lib.distances import calc_angles, calc_dihedrals

    heavy_groups = []
    for positions in groups:
        group = atoms[positions].residues.atoms
        if hasattr(group, "altLocs"):
            group = group[np.isin(group.altLocs, ["", "A"])]
        guesser = DefaultGuesser(None)
        elements = group.elements if hasattr(group, "elements") else guesser.guess_types(group.names)
        elements = np.char.upper(np.char.strip(np.asarray(elements, dtype="U4")))
        unknown = elements == ""
        if unknown.any():
            elements[unknown] = np.char.upper(np.asarray(guesser.guess_types(group.names[unknown]), dtype="U4"))
        group = group[~np.isin(elements, ["H", "D"])]
        if not len(group):
            raise ValueError("Each observable group must contain a heavy atom.")
        heavy_groups.append(group)
    values = []
    for frame_index, frame in enumerate(frames):
        if frame_index % 10 == 0: report_progress("Extracting trajectory features", frame_index, len(frames))
        universe.trajectory[int(frame)]
        xyz = [group.positions for group in heavy_groups]
        if kind == "minimum":
            value = cKDTree(xyz[1]).query(xyz[0])[0].min()
        elif kind == "contacts":
            cutoff = np.nextafter(spec["cutoff"], -np.inf)
            value = cKDTree(xyz[0]).count_neighbors(cKDTree(xyz[1]), cutoff)
        else:
            centers = [x.mean(0) for x in xyz]
            if kind == "center":
                value = np.linalg.norm(centers[1] - centers[0])
            else:
                calculator = calc_angles if kind == "angle" else calc_dihedrals
                value = np.rad2deg(calculator(*centers))
        values.append(float(value))
    if not np.isfinite(values).all():
        raise ValueError("The selected observable is undefined in one or more retained frames.")
    unit = "pairs" if kind == "contacts" else "°" if kind in {"angle", "dihedral"} else "Å"
    return dict(values=values, unit=unit, circular=kind == "dihedral")


def welch_cluster_pairs(groups, anchor=None):
    """Exploratory pairwise tests on independent-frame summary statistics."""
    if anchor is None:
        comparisons = list(combinations(groups, 2))
    else:
        anchor_group = next(group for group in groups if group["id"] == anchor)
        comparisons = [(anchor_group, group) for group in groups if group["id"] != anchor]
    eligible = [(a, b) for a, b in comparisons
                if min(a["count"], b["count"]) >= 5 and (a["sd"] or b["sd"])]
    pairs = []
    if eligible:
        first, second = zip(*eligible)
        summary = lambda groups, key: np.array([group[key] for group in groups])
        result = ttest_ind_from_stats(
            summary(first, "mean"), summary(first, "sd"), summary(first, "count"),
            summary(second, "mean"), summary(second, "sd"), summary(second, "count"),
            equal_var=False,
        )
        pairs = [dict(first=a["id"], second=b["id"], p=float(p))
                 for (a, b), p in zip(eligible, result.pvalue) if np.isfinite(p)]
    ordered = sorted(pairs, key=lambda row: row["p"])
    previous = 0.0
    for i, row in enumerate(ordered):
        previous = max(previous, min(1.0, row["p"] * (len(ordered) - i)))
        row["adjusted"] = previous
    return pairs


def residue_associations(structure, settings, spec):
    """Rank uniform-weight Spearman associations for retained trajectory frames."""
    retained = settings["frame_indices"]
    values = np.asarray(spec["values"], dtype=float)
    if values.shape != (len(retained),) or not np.isfinite(values).all():
        raise ValueError("Provide one finite observable value per retained frame.")
    frames = spec.get("frames")
    if frames is None:
        frames = retained
    if (not isinstance(frames, list) or any(type(frame) is not int for frame in frames)
            or not set(frames) <= set(retained)):
        raise ValueError("Association frames must come from the retained PCA frames.")
    if len(frames) < 20:
        raise ValueError("Residue ranking requires at least 20 frames in the selected scope.")
    feature = spec["feature"]
    if feature == "sasa" and len(frames) > spec["sasa_max_frames"]:
        subset = np.linspace(0, len(frames) - 1, spec["sasa_max_frames"], dtype=int)
        frames = [frames[i] for i in subset]
    universe, atoms, residues, indices = trajectory_inputs(structure, settings | {"frame_indices": frames})
    by_frame = dict(zip(retained, values))
    observable = np.array([by_frame[frame] for frame in indices])
    circular = spec.get("kind") == "dihedral"
    if np.ptp(observable) == 0:
        raise ValueError("The observable is constant in this frame selection.")
    components = (np.column_stack((np.sin(np.deg2rad(observable)), np.cos(np.deg2rad(observable))))
                  if circular else observable[:, None])
    # Rounding angular transforms removes numerical differences for equivalent angles.
    if circular:
        components = np.round(components, 12)
    if not np.any(np.ptp(components, axis=0) > 0):
        raise ValueError("The observable is constant in this frame selection.")

    excluded = set(spec.get("exclude", []))
    if feature == "distance":
        reference = node_positions(residues, spec["reference"], "Distance reference")
        excluded.update(residues[i]["id"] for i in reference)
    eligible = [i for i, r in enumerate(residues) if r["id"] not in excluded]
    if not eligible:
        raise ValueError("No residues remain after exclusions.")
    if feature == "sasa":
        features = np.stack([area[eligible] for area in
                             residue_sasa_frames(universe, atoms, "protein", indices, 120, workers=spec.get("workers", 1))])
    else:
        coordinates = ca_coordinates(atoms, indices)
        if feature == "displacement":
            reference_xyz = np.array([r["ca"] for r in residues], dtype=float)
            fit = node_positions(residues, settings.get("fit") or [r["id"] for r in residues], "Alignment selection")
            aligned = align_frames(coordinates, reference_xyz, fit)
            features = np.linalg.norm(aligned[:, eligible] - reference_xyz[eligible], axis=2)
        else:
            features = np.empty((len(indices), len(eligible)))
            for i, xyz in enumerate(coordinates):
                if feature == "distance":
                    features[i] = cdist(xyz[eligible], xyz[reference]).min(axis=1)
                else:
                    pairs = cKDTree(xyz).query_pairs(np.nextafter(spec["cutoff"], -np.inf), output_type="ndarray")
                    features[i] = np.bincount(pairs.ravel(), minlength=len(atoms))[eligible]

    x = rankdata(features, axis=0)
    y = rankdata(components, axis=0)
    x -= x.mean(axis=0)
    y -= y.mean(axis=0)
    norm = np.outer(np.linalg.norm(x, axis=0), np.linalg.norm(y, axis=0))
    correlations = np.divide(x.T @ y, norm, out=np.full(norm.shape, np.nan), where=norm > 0)
    correlations = np.clip(correlations, -1, 1)
    rows = []
    for i, coefficients in zip(eligible, correlations):
        available = np.isfinite(coefficients)
        score = float(np.max(np.abs(coefficients[available]))) if available.any() else None
        rows.append(dict(id=residues[i]["id"], score=score,
                         coefficients=[float(v) if np.isfinite(v) else None for v in coefficients]))
    rows.sort(key=lambda row: (row["score"] is None, -(row["score"] or 0)))
    return dict(rows=rows, frame_count=len(indices), circular=circular,
                excluded=len(residues) - len(eligible))


def frame_structure(structure, settings, frame):
    universe, atoms, residues, _ = trajectory_inputs(structure, settings)
    universe.trajectory[frame]
    return aligned_frame_pdb(structure, atoms, residues, settings.get("fit"))


def aligned_frame_pdb(structure, atoms, residues, fit_ids=None):
    reference = np.array([r["ca"] for r in residues], dtype=float)
    fit = node_positions(residues, fit_ids or [r["id"] for r in residues], "Alignment selection")
    if len(fit) < 3 or np.linalg.matrix_rank(reference[fit] - reference[fit].mean(axis=0)) < 2:
        raise ValueError("Frame alignment requires three non-collinear Cα atoms.")
    current = atoms.positions.astype(float)
    moving, fixed = current[fit], reference[fit]
    moving_center, fixed_center = moving.mean(0), fixed.mean(0)
    u, _, vt = np.linalg.svd((moving - moving_center).T @ (fixed - fixed_center))
    u[:, -1] *= np.linalg.det(u @ vt)
    rotation = u @ vt
    mapped = {}
    for atom, r in zip(atoms, residues):
        key = (r["chain"], r["segid"], r["resid"], r["icode"])
        group = atom.residue.atoms
        if hasattr(group, "altLocs"):
            group = group[np.isin(group.altLocs, ["", "A"])]
        coords = (group.positions - moving_center) @ rotation + fixed_center
        mapped[key] = dict(zip(group.names, coords))
    output = []
    for line in structure["pdb"].splitlines():
        if not line.startswith("ATOM  "):
            continue
        key = pdb_residue_key(line)
        xyz = mapped.get(key, {}).get(line[12:16].strip())
        if xyz is not None:
            output.append(line[:30] + "".join(f"{v:8.3f}" for v in xyz) + line[54:])
    return "\n".join(output + ["END", ""])


def compare_state_contacts(structure, settings, states, groups, path, cutoff):
    """Count Cα contacts in two disjoint ensembles using one residue mapping."""
    retained = set(settings["frame_indices"])
    member_sets = []
    for state in states:
        frames = state["frames"]
        if (not isinstance(frames, list) or not frames
                or any(type(frame) is not int for frame in frames)
                or frames != sorted(set(frames)) or not set(frames) <= retained
                or state["representative"] not in frames):
            raise ValueError("Choose two valid states from the current clustering.")
        member_sets.append(set(frames))
    if member_sets[0] & member_sets[1]:
        raise ValueError("Choose two states with disjoint frames.")

    universe, atoms, residues, _ = trajectory_inputs(structure, settings)
    all_ids = [r["id"] for r in residues]
    if path:
        node_positions(residues, path, "Path")
        lookup = {node: i for i, node in enumerate(all_ids)}
        edges = {tuple(sorted((lookup[a], lookup[b]))) for a, b in zip(path, path[1:]) if a != b}
        if not edges:
            raise ValueError("Choose a path with at least one edge.")
        left = right = sorted({i for edge in edges for i in edge})
    else:
        edges = None
        left, right = [node_positions(residues, group or all_ids, "Contact group").tolist()
                       for group in groups]
    left_set, right_set = set(left), set(right)

    counts = [{}, {}]
    models = []
    from scipy.spatial.distance import cdist

    for state, hits in zip(states, counts):
        for frame in state["frames"]:
            universe.trajectory[frame]
            xyz = atoms.positions
            if not np.isfinite(xyz).all():
                raise ValueError(f"Frame {frame} has non-finite Cα coordinates.")
            # Enumerate contacts for the chosen groups, then collapse symmetric pairs.
            pairs = set()
            if edges is not None:
                pairs = {(a, b) for a, b in edges if np.linalg.norm(xyz[a] - xyz[b]) < cutoff}
            elif len(left) * len(right) < len(xyz) ** 2 // 4:
                pairs = {tuple(sorted((left[a], right[b])))
                         for a, b in zip(*np.where(cdist(xyz[left], xyz[right]) < cutoff))
                         if left[a] != right[b]}
            else:
                pairs = {(int(a), int(b)) for a, b in cKDTree(xyz).query_pairs(np.nextafter(cutoff, 0.0), output_type="ndarray")
                         if (a in left_set and b in right_set) or (b in left_set and a in right_set)}
            for pair in pairs:
                hits[pair] = hits.get(pair, 0) + 1
        universe.trajectory[state["representative"]]
        models.append(aligned_frame_pdb(structure, atoms, residues, settings.get("fit")))

    rows = []
    for a, b in counts[0].keys() | counts[1].keys() | (edges or set()):
        first, second = [hits.get((a, b), 0) / len(state["frames"]) for state, hits in zip(states, counts)]
        rows.append(dict(a=all_ids[a], b=all_ids[b], first=first, second=second, delta=second - first))
    rows.sort(key=lambda row: (-abs(row["delta"]), row["a"], row["b"]))
    return dict(rows=rows, frame_counts=[len(state["frames"]) for state in states],
                left=[all_ids[i] for i in left], right=[all_ids[i] for i in right],
                models=models, cutoff=cutoff)
