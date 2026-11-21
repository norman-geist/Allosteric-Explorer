<p align="center"><img src="static/branding/app-logo.png" width="100" alt="Allosteric Explorer logo"></p>

# Allosteric Explorer

![Allosteric Explorer molecular communication banner](static/branding/molecular-banner.png)

**Explore protein pockets, conformational ensembles, and candidate allosteric communication.**

Allosteric Explorer is a local Python application with a browser interface for structural and trajectory analysis. It connects pocket discovery, residue communication networks, conformational analysis, and elastic-network perturbation responses in one workspace. Structures and trajectories are processed on the machine running the backend. The 3D viewer and visual assets are bundled for offline use after installation.

**Author:** Norman Geist · University of Greifswald, Institute of Biochemistry

## What you can do

| Tab | Analyses |
| --- | --- |
| Pocket discovery | Detect cavities with fpocket, inspect lining residues and nearby reference ions, and track detection occupancy and volume across sampled trajectory frames. |
| Communication | Calculate displacement or contact-count correlations; build contact-occupancy-weighted residue networks; inspect candidate routes and pocket participation. |
| Conformations | Perform Cartesian, dihedral, or paired-distance ccPCA; cluster projected frames; inspect representatives, observables, residue associations, and state contact differences. |
| Perturbation | Scan a Cα anisotropic elastic network, rank perturbation sources and responding residues, and summarize pocket responses. |

Interactive structures use **3Dmol.js**. Plots support SVG, PNG, and numerical data exports; tables and run settings can also be exported.

## Quick start

Install [Conda](https://docs.conda.io/projects/conda/en/stable/user-guide/install/index.html) or a compatible Conda environment manager, then:

```bash
git clone https://github.com/norman-geist/Allosteric-Explorer.git Allosteric_Explorer
cd Allosteric_Explorer
conda env create -f environment.yml
conda activate allosteric-explorer
chmod +x Allosteric_Explorer.py
./Allosteric_Explorer.py
```

The default launch opens a dedicated Chromium or Chrome app window automatically. With the environment activated, you can launch it from any working directory as `/path/to/Allosteric_Explorer/Allosteric_Explorer.py`; no `--server` flag is needed. Run `chmod +x` once after cloning or extracting if executable permissions are missing.

For an ordinary browser tab or an SSH tunnel, use `./Allosteric_Explorer.py --server` and open **http://127.0.0.1:8765** instead.

See **[Installation](INSTALLATION.md)** for environment setup, desktop dependencies, remote use, and troubleshooting.

## First analysis

1. Open a protein PDB in **Pocket discovery**, choose the assembly or chain scope, and select **Detect pockets**.
2. Inspect a cavity and use its lining residues as Region A, Region B, or a functional reference.
3. Load a matching topology and a pre-imaged trajectory for **Communication** or **Conformations**. Confirm residue mapping, sampling, and selections before calculating.
4. Inspect coupling, paths, clusters, and observables; use **Perturbation** to evaluate mechanical responses in the reference or a cluster representative.
5. Export numerical results and settings, and record the exact software revision with the input files and selected frame indices.

Pocket discovery and perturbation scanning can be run from a structure alone. Trajectory-based analyses require a matching topology and trajectory; fpocket persistence scans require the reference protein heavy atoms in the trajectory.

## Documentation

- **[Installation](INSTALLATION.md)** — Conda, existing environments, desktop/server launch, and SSH tunneling.
- **[Usage guide](USAGE.md)** — all four tabs, selection syntax, parameters, exports, and interpretation.
- **[Methodological details](METHODS.md)** — implemented equations, scoring definitions, assumptions, references, and reporting checklist.
- **[Adaptable Methods template](METHODS_TEMPLATE.md)** — modular manuscript text with study-specific placeholders.
- **[Short Methods paragraph](METHODS_SHORT.md)** — concise manuscript description with major references, including visualization.

## Scientific scope

Cavities, correlations, network paths, and linear mechanical responses provide complementary evidence for candidate sites and mechanisms. They do not by themselves establish ligand binding, causal signaling, or allostery. Distances use direct Cartesian coordinates, so trajectories must be made whole and imaged beforehand. Analysis frames are equally weighted; occupancy landscapes require an appropriate sampling interpretation. PRS is a static protein Cα model with no explicit ion nodes.

The app-specific ccPCA representation uses normalized distances between ordered atom pairs. Communication costs combine absolute coupling and contact occupancy. These definitions and pocket-ranking choices are documented in [METHODS.md](METHODS.md).

## Citation

When reporting analyses, cite **Allosteric Explorer, the exact version or commit**, and the underlying methods and libraries actually used. Citation metadata is provided in [CITATION.cff](CITATION.cff). No archived release DOI has been assigned yet.

Suggested software reference: Geist N. *Allosteric Explorer*. Version 1.0.0. https://github.com/norman-geist/Allosteric-Explorer

## Licensing and credits

A license for the project's original source has not yet been selected. Bundled third-party components retain their own notices: [3Dmol.js](static/vendor/3Dmol-LICENSE), [additional bundled notices](static/vendor/3Dmol-min.js.LICENSE.txt), and [DM Sans](static/vendor/DM-Sans-OFL.txt).

The banner and logo are illustrative; they do not depict analysis results.
