"""Linear perturbation responses of a Cα anisotropic elastic network."""
import base64
from progress import report as report_progress

import numpy as np
from scipy.linalg import eigh
from scipy.spatial import cKDTree


def scan_response(structure, sources, targets, cutoff):
    residues = [r for r in structure["residues"] if r["ca"] is not None]
    positions = {r["id"]: i for i, r in enumerate(residues)}
    if not 4 <= len(residues) <= 1200:
        raise ValueError("Perturbation scanning supports structures with 4–1,200 Cα atoms.")
    if not set(targets) <= positions.keys() or not set(sources) <= positions.keys():
        raise ValueError("Choose source and target residues with Cα atoms.")
    source_ids = list(dict.fromkeys(sources or positions))
    target_ids = list(dict.fromkeys(targets or positions))
    source_indices = [positions[node] for node in source_ids]
    target_indices = np.array([positions[node] for node in target_ids])
    xyz = np.array([r["ca"] for r in residues])
    size = len(xyz)
    hessian = np.zeros((3 * size, 3 * size))
    for i, j in cKDTree(xyz).query_pairs(cutoff, output_type="ndarray"):
        delta = xyz[j] - xyz[i]
        distance_sq = delta @ delta
        if distance_sq < 1e-12:
            raise ValueError("The structure contains coincident Cα atoms.")
        spring = np.outer(delta, delta) / distance_sq
        row = slice(3 * i, 3 * i + 3)
        column = slice(3 * j, 3 * j + 3)
        hessian[row, column] = hessian[column, row] = -spring
        hessian[row, row] += spring
        hessian[column, column] += spring
    report_progress("Diagonalizing elastic-network Hessian")
    values, vectors = eigh(hessian, overwrite_a=True)
    active = values > max(1e-10, values[-1] * 1e-8)
    if np.count_nonzero(~active) != 6:
        raise ValueError("The elastic network has extra zero modes. Increase the cutoff or use a connected structure.")
    modes = vectors[:, active]
    covariance = (modes / values[active]) @ modes.T
    rows = []
    pair_scores = np.empty((len(source_ids), size), dtype="<f4")
    response_sum = np.zeros(size)
    response_count = np.full(size, len(source_ids))
    for row_index, (node, i) in enumerate(zip(source_ids, source_indices)):
        if row_index % 10 == 0: report_progress("Computing isotropic source responses", row_index, len(source_ids))
        response = covariance[3 * i:3 * i + 3].reshape(3, size, 3)
        # E[ffᵀ] = I/3 for an isotropic unit force at the source.
        power = np.square(response).sum(axis=(0, 2)) / 3
        power[i] = 0
        pair_scores[row_index] = np.sqrt(power)
        pair_scores[row_index, i] = np.nan
        response_sum += power
        response_count[i] -= 1
        scored = target_indices[target_indices != i]
        rows.append(dict(id=node, score=float(np.sqrt(power[scored].mean())) if scored.size else None,
                         target_count=int(scored.size)))
    rows.sort(key=lambda row: (row["score"] is None, -(row["score"] or 0)))
    response = [dict(id=r["id"], score=float(np.sqrt(total / count)) if count else None)
                for r, total, count in zip(residues, response_sum, response_count)]
    distances, _ = cKDTree(xyz[source_indices]).query(xyz)
    for row, distance in zip(response, distances):
        row["distance"] = float(distance)
    return dict(rows=rows, response=response, nodes=size, cutoff=cutoff, targets=target_ids,
                sources=source_ids, pair_scores=base64.b64encode(pair_scores.tobytes()).decode("ascii"))
