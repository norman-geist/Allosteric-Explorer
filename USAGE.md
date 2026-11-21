# Allosteric Explorer

A local browser GUI for finding protein cavities and examining how their lining residues communicate in a molecular dynamics ensemble. The Python backend runs fpocket and MDAnalysis on your machine. The bundled 3D viewer works offline after installation.

See [METHODS.md](METHODS.md) for manuscript text, method references, and the study reporting checklist.

The header uses a molecular banner behind the workflow tabs and a matching protein-network logo. The artwork and caption change with the active tab: cavities for Pocket discovery, routes for Communication, overlapping structures for Conformations, and a push/response illustration for Perturbation. **Hide banner** collapses the illustration while keeping all workflow tabs available; **Show banner** restores it. This preference is remembered in the browser when storage is available. The illustrations do not depict the loaded protein or its analysis results. All visual assets are bundled for offline use.

## Workspace and inspection

**About** shows the version, suggested software citation, Methods, residue selection syntax, and ion/model scope. Forms share compact controls and advanced sections. Calculations show elapsed time plus authenticated backend stage updates. Frame counters are reported for trajectory reading, contact occupancy, feature extraction, SASA and pocket tracking where available. Eigensolvers, SVD and external fpocket processes show their current stage without a fabricated percentage. A context strip reports the loaded structure and available analysis counts. Empty panels describe the next useful action.

Each analysis follows **summary → plots → tables → detailed inspection**. Communication and both PRS workflows share this order; Conformations places PCA/FEL plots before its cluster table and frame viewer. Pocket tracking, observables and contact comparisons follow the same pattern within their own sections. Summaries include an expandable snapshot of selections and settings actually used, with **Settings JSON** export. PRS summaries also record the current displayed source and responder scope. Cluster rows and plotted points retain their inspection links.

Advanced panels group optional references, sampling/network settings, PCA fitting/clustering settings and association exclusions. Coupling method, PCA representation, clustering method, source/target choices and primary actions remain visible. Frame-count readouts stay visible when technical panels are collapsed. Each analysis form has one primary action.

Plots share typography, label sizes, export controls and base margins. Blue/white/red encode signed negative/zero/positive values; unsigned scalar coloring is sequential; circular observables retain cyclic coloring; clusters use a separate stable palette; site/region colors retain their identity. PCA axes state Å or dimensionless scores. Table counts are integers, percentages use one decimal, Å-based quantities two decimals, coefficients three decimals, and p-values four decimals with scientific notation for small values. Combined mean/SD or score/rank cells retain their explicit analysis labels. Table CSV is display-formatted; Data CSV retains figure values.

The residue–observable association result includes a clickable signed-coefficient profile linked to its table and frame highlights. For circular observables it plots the sine and cosine coefficients separately.

All summary tables created by the shared table component support column sorting, row filtering, and **Table CSV** export. Table CSV exports displayed values with their displayed precision; use **Data CSV** on plots for the underlying numerical figure data. Plot exports use consistent SVG/PNG/data controls, and PNG resolution follows the global DPI setting. Numeric cells use aligned tabular figures.

Hover protein atoms in any molecular viewer to inspect residue name, number, insertion code, chain and segid. The main viewer's **Click action** menu chooses inspection, highlighting, Region A/B, functional-reference selection, or PRS source/monitored-region selection. **Add to selection** accumulates picks into the current highlighted set; turn it off to replace the set on each click. Click inspection retains PRS responder inspection. Frame-viewer highlights use the same selections. The tooltip identifies residues even when residue numbers are repeated across chains.

Simple residue lists (`A:40, PROA:158-170` or `A/PROA:40`) remain supported. Boolean expressions accept `chain`, `segid`, `resid`, `resname`, `protein`/`all`, `and`, `or`, `not`, parentheses, quoted identifiers and name wildcards. Examples:

```
segid PROA and resid 40:60
(chain A or chain B) and not resname GLY
segid "PRO A" and (resid 40 or resid 85:95)
```

Precedence is `not`, then `and`, then `or`. Numeric ranges are inclusive. These selectors apply to mapped protein residues; trajectory atom-selection fields continue to use MDAnalysis syntax.

Recognized monatomic ions are retained from the reference PDB and shown as optional labeled spheres under **Display and export**. Recognition does not distinguish structural from solvent ions. Pocket details list retained ions within 5 Å of any fpocket bead, using Euclidean distances without periodic corrections. This is proximity, not a binding or coordination assignment. The detector still receives protein atoms only: ion occupancy does not reduce the reported pocket volume. Communication and PRS remain protein Cα models, so they do not explicitly calculate ion-mediated communication. Ion markers are included in scene exports. Trajectory frame reconstruction omits reference ions rather than projecting static positions onto changing protein conformations. Waters and other ligands are not retained by this change.

## Install and launch

On Linux, clone or extract the source into an Allosteric_Explorer directory, install Chromium or Google Chrome, open a terminal in that directory, and perform the one-time setup:

```bash
conda env create -f environment.yml
conda activate allosteric-explorer
chmod +x Allosteric_Explorer.py
./Allosteric_Explorer.py
```

For subsequent launches, activate the environment and run `/path/to/Allosteric_Explorer/Allosteric_Explorer.py` directly from your chosen working directory. With no arguments, app-window mode is the default; no `--server` flag is needed.

Desktop mode uses an installed Chromium or Google Chrome to open a dedicated window with no address bar, tabs, or browser toolbar. The launcher starts the Python backend on a free loopback port and stops it when the window closes. To choose a browser executable, pass `--browser /path/to/chromium`.

Install `kdialog` on KDE Plasma or `zenity` on GNOME to enable the system file choosers. On openSUSE, use `sudo zypper install kdialog` or `sudo zypper install zenity`.

The choosers start in the working directory you launched the app from. Topology, trajectory, and CSV choosers use the directory of the current or related file when a path is already filled in. In server mode, and in desktop mode without a system chooser, **Open PDB** and **Browse…** list files on the machine running the app. **Upload PDB** selects a structure from the browser’s machine.

For ordinary browser or SSH tunnel use, run `./Allosteric_Explorer.py --server` and open [http://127.0.0.1:8765](http://127.0.0.1:8765). To use an existing environment, install the Python dependencies with `python -m pip install -r requirements.txt` and install fpocket with `conda install -c conda-forge fpocket`. The app looks for fpocket in the active environment and on PATH.

Open the **Global settings** gear next to **Open PDB** to set **CPU workers**, the maximum number of simultaneous workers per pocket-tracking or SASA run. The default is 4 and 1 runs sequentially. The server caps the worker count by available logical CPUs and sampled frames. SASA uses frame-level parallelism for the Communication exposure filter, the Conformations trajectory observable, and residue–observable association.

The app starts with an empty workspace. **Clear** removes the loaded structure, selections, and displayed analysis results and restores the default settings. Input files and exported files stay on disk.

## Pocket discovery

1. Open a PDB, choose **All chains together** or a single chain under **Scan**, and click **Detect pockets**. Scanning all chains preserves interfaces. A single-chain scan treats that chain as isolated, so it can expose surfaces covered in the complex. Detection uses the protein atoms of the first model, keeps the blank or A alternate locations, and excludes solvent and bound ligands. Use unique PDB chain IDs when residue numbers repeat.
2. Use the checkbox beside each pocket to toggle its lining residues and alpha-sphere centers. The current rotation, translation, and zoom are retained. Use **Display and export** to change the protein representation and **Reset view** to return to the opening view.
3. Enter residue IDs such as `40, 78, 158`, `A:40, A:78, A:158`, or `A:174-184`. A bare number applies to every matching chain. `A:45B` selects insertion code B at residue 45. For a blank chain, use `_:45`. Highlighting adds gold sticks and labels for selections of up to 24 residues. For larger selections, gold sticks remain visible.
4. Click a pocket name to see its lining residues and assign it to Region A, Region B, or the functional reference. **Copy residue IDs** gives a comma-separated selection for Highlights or other custom residue fields. The list can also be selected and copied manually.

**fpocket settings** controls the minimum and maximum alpha-sphere radius and the minimum number of spheres per pocket. Blank fields use fpocket defaults. A lower minimum radius includes tighter interstices, a higher maximum radius includes wider depressions, and fewer spheres can retain smaller cavities. Compare with the default scan before interpreting additional pockets.

**Clustering distance** (`-D`, default 2.4 Å) controls how readily nearby groups of alpha spheres merge. Lower it to split subpockets, or raise it to group them. **Clustering method** (`-C`) offers single, complete, average, and centroid linkage. Complete linkage favors compact clusters and is less likely than single linkage to join lobes connected by a thin bridge. If a split pocket disappears, check whether its fragments fall below **Min. spheres per pocket**.

The pocket and druggability columns show fpocket descriptors. A cavity is a candidate binding site. Its allosteric role requires additional evidence.


### Pocket occupancy and volume

Detect pockets, show the ones you want to track, and open **Pocket occupancy and volume** in the Pocket tab. Choose a trajectory and matching topology, or copy them from Communication. Use a pre-imaged trajectory. The app runs fpocket once per sampled frame with the reference scan's chain scope and settings. Each visible reference pocket is matched independently to the candidate with the highest Jaccard similarity if it meets the minimum. If two pockets merge, they can both match the same cavity. Pocket numbers can change between snapshots.

The default samples up to 30 frames across the strided trajectory, with a maximum of 1,000. Pocket tracking uses the normal PDB structure limits. The top-level **CPU workers** setting controls concurrent fpocket scans. The results show the effective worker count. The summary shows occupancy as the fraction of sampled frames with a qualifying match and mean volume across matched frames with a reported volume. It also reports the frame counts used. Export the summary or frame data for all tracked pockets as CSV. Select a pocket in the summary or dropdown to inspect its plots. The volume trace connects consecutive sampled frames with reported volumes. Frame −1 is drawn separately. The plots use zero-based saved frame indices.

The plots appear below the 3D viewer. Click a detection or volume point, or choose a sampled frame from the list, to preview it in 3D with the same camera and display settings. **Reference pocket visibility** lets you show or hide each pocket's lining residues on the previewed structure. These settings carry across the preview frames. Purple Cα markers emphasize the inspected pocket when it is visible and **Show reference lining** is enabled under **Display and export**. Select **Original PDB · frame −1** to see the original pockets and their fpocket beads. The PDB is excluded from occupancy and mean volume. **Current structure (exit preview)** restores the active structure and its pocket visibility. **Run pocket detection on frame** performs a new scan with the original chain scope and fpocket settings and replaces the current structure and its analyses. The cavity that best matches the inspected reference pocket is selected if it meets the overlap threshold. The sidebar reports the best overlap and lists all cavities found in that frame. The tracking results remain available after detection.

## Communication

Use **Browse…** to choose topology and trajectory files. Server browsing lists common MDAnalysis formats. You can also enter other supported paths directly on the machine running the app. The selected topology and reference PDB must describe the same Cα residues. The app reorders the topology Cα atoms to match the PDB, using chain IDs or matching segment IDs to resolve repeated residue identities. When identifiers differ, it can infer a match from distinct residue signatures. Identical chains require matching IDs. For a PSF, use a selection such as `protein and segid PROA` when your reference contains only that segment. Use a whole, pre-imaged trajectory if periodic boundaries split the protein.

### Discover or connect

- Set **Region A** and leave **Region B** empty to discover residues outside A. The table ranks candidates by their mean absolute correlation with the residues of A. The signed mean can be smaller when positive and negative correlations cancel.
- Use **Candidate filters** to keep surface or buried residues, enforce a minimum mean distance from A, or require a path in the contact network. The distance is the average across frames of the minimum Cα distance to A. The default accessibility setting ranks all residues.
- Surface and buried use mean heavy-atom SASA from evenly spaced retained frames. Choose up to 240 SASA snapshots. Shrake–Rupley uses a 1.4 Å probe and configurable sphere sampling. The threshold is an absolute area in Å². A residue at the threshold is classified as surface. The shielding selection supplies neighboring atoms, and all analyzed residues always contribute their heavy atoms. Inspect sensitivity to the threshold and sampling when refining a shortlist.
- Set **Region B** to inspect its residues as endpoints. Distance, accessibility and reachability filters are bypassed so disconnected and buried endpoints remain visible. SASA can still be calculated for their readouts.
- **Pocket ranking** defaults to summed mean |r| to Region A across distinct reachable eligible lining residues, without dividing by pocket size. Scoring uses all candidates passing the analysis filters; **Top 25**, **Top 100**, and **All candidates** control the residue table only. An optional minimum mean |r| threshold (default 0) applies to the sum and participating count. Switch to residue count or the full-lining mean. The table shows the sum, participating count, strongest residue, and full-lining mean together; larger pockets can accumulate larger sums, so compare these metrics. Select a pocket to inspect contributing residues. Plot CSV export includes all summary metrics, the reference, threshold, and contributing residues.
- Switch to **Mean |r| across lining residues** to average correlations across all matched lining–reference pairs, excluding reference residues on the pocket side. The reference is Region A by default or the optional **Functional reference**. This mean uses the mapped lining regardless of the candidate table filters and display limit. **Pocket coupling stability** compares mean |r| scores and ranks over the first and second halves of the retained frames. For a replicate or another state, run Communication with matching settings, export its run JSON, and load it under **Compare a second run JSON**. The comparison matches pockets by lining residue identity and reports the change in mean |r|. These comparisons are descriptive.

### Correlations and network paths

After you select the topology and trajectory, the sampling controls show the saved frame count, the count after stride, and the count retained after applying the cap. This readout is available in Communication, Conformations, and pocket tracking. Use stride 1 to let the cap spread samples across all saved frames. Increase stride when you want a fixed interval in saved frames and the cap will not bind. Explicit cluster-frame selections in Communication use their own frame list.

Communication uses 20–10,000 retained frames and uniform weights, with up to 1,800 Cα nodes. **Displacement DCC** compares Cα displacement vectors after aligning on Cα atoms outside A. **Contact-change correlation** is the Pearson correlation between per-residue Cα contact counts. Correlations involving effectively constant features are represented as zero. Edges must pass the occupancy and absolute correlation thresholds. Shortest paths use `−log(occupancy × |r|)` per edge. Edge details show signed correlation and occupancy. Use the **?** buttons for explanations of individual settings.

For a reachable target, **Find alternate routes** returns up to five lowest-cost loopless routes from any Region A residue to that target. Pick a route to update the 3D path and edge table. Δ is the extra cost relative to the cheapest route. Routes can share edges and can start at different residues in A. The server keeps the two most recently used analysis networks in memory for this calculation.

### Figures and exports

Use **Read the map** below the signed correlation matrix to interpret its axes and colors for the selected coupling method.

- The four diagnostics are the coupling profile to A, the signed pairwise correlation matrix, first-half vs second-half coupling, and Cartesian PCA of aligned Cα coordinates. The split-half comparison is a descriptive stability check. PCA points show retained trajectory frame indices. All plots use the full set of Cα nodes or retained frames.
- Use **Plot overlays** to toggle Regions A and B, the functional reference, manually highlighted residues, and predicted pocket lining residues. Select all pockets or one pocket. Markers sit on the mean absolute coupling line, with rings indicating overlapping groups. The toggles also control site annotations on the correlation matrix and split-half plot, and carry over to the exported figures. The residue table’s **Sites** column lists each pocket that contains the residue. Click a residue in the table or an applicable plot to inspect it on the protein. The 3D view can color the protein by mean signed correlation to Region A and show the chosen network path on the displayed reference PDB.
- Export each figure as SVG or a 3× PNG. The SVG heatmap embeds a full-resolution matrix raster and uses vector labels and annotations. Save the current 3D view as a PNG at the viewer resolution.
- **Export CSV** includes the full residue profile, candidate flags, SASA when calculated, site membership, path summaries and pocket ranks. **Export matrix CSV** contains the signed pairwise values. **Export run JSON** records analysis settings, node mapping, retained frame indices, SASA frame indices, PCA projections, path edge values, and any alternate routes retrieved during the run. The matrix has its own export.

The app analyzes one trajectory at a time. Correlation and network paths are evidence of coordinated motion in the sampled ensemble. Testing a mechanistic allosteric hypothesis calls for independent trajectories, perturbations, or experiments.

## Conformations

Conformations supports up to 10,000 retained frames and 2,500 Cα nodes. Memory and runtime grow with the number of frames and features. Ward clustering can use substantially more memory at high frame counts.

1. Open **Conformations** and select the same topology and trajectory used for Communication. **Use Communication inputs** copies the paths, topology selection, and frame sampling settings. The reference PDB supplies residue identities and the alignment target.
2. Choose **Cartesian Cα**, **Backbone φ/ψ dihedrals**, or **Contact-contact PCA (ccPCA)**. Set the number of leading PCs and choose k-means, Ward hierarchical clustering, or DBSCAN. Under **Frame and residue selection**, you can restrict the PCA features to a loop and align Cartesian coordinates on a separate stable core. Dihedral PCA uses sine and cosine of φ/ψ at continuous peptide bonds. It omits angles that are undefined in any retained frame.
3. Click a PCA point to inspect that exact aligned frame or choose a cluster to show its representative. The representative is the retained frame nearest the cluster centroid in the PCs used for clustering. The PCA legend identifies cluster colors and appears in SVG and PNG exports. Change the displayed axes independently of the fitted clusters.
4. **Use for pockets** opens the displayed aligned frame in Pocket discovery and replaces the current reference structure and its analysis results. **Export frame PDB** saves the same frame to the app’s working directory. To export frame IDs, cluster membership and scores, use the conformation CSV export.
4. Choose a **Trajectory observable** after clustering. Options are minimum heavy-atom distance, geometric-center distance, heavy-atom contact count, angle or dihedral between group centers, reference Cα RMSD, group solvent-accessible surface area (SASA), radius of gyration, and a local CSV with `frame,value` columns. Use pockets, selected regions, highlighted residues, or custom residue IDs for the groups. Results include a frame plot, distributions, and per-cluster summaries. The dihedral uses circular means and resultant lengths. You can also color the PCA by the observable.
5. Choose **Use cluster frames in Communication** to analyze that cluster's exact trajectory frames. This is available for clusters with at least 20 retained frames. Clearing the selection or changing the Communication dataset or sampling inputs returns to ordinary frame sampling.

PCA and clustering describe structural groups in the retained ensemble. Cluster assignments can change with the feature selection, number of PCs, and cluster count. Use pre-imaged trajectories. The conformations tab compares observable distributions across clusters and supports individual cluster communication runs.

### Contact-contact PCA (ccPCA)

Enter two MDAnalysis atom selections. For a two-segment selection, use `segid PROA and not (name H*)` and `segid PROB and not (name H*)`. The app selects from the full trajectory topology in topology order, independently of the Cα mapping used for the frame viewer and Communication. Each group needs at least two atoms.

The app pairs atoms in topology order. For group lengths `n1` and `n2`, use `m = min(n1, n2)` pairs. In each group, keep every `floor(n/m)`-th atom starting at the first, then take the first `m` entries and pair by position. For each retained frame, compute the Euclidean distances of those pairs and divide by their mean distance in that frame. PCA uses the resulting dimensionless features. Use a pre-imaged trajectory with the groups in the intended periodic images. Alignment affects frame display and RMSD calculations.

The app fits PCA on the retained frames. It reports the pair count and group strides and supports the same clustering, frame inspection, landscape, PC-score observables, and Communication handoff as the other PCA modes.

### Site exposure as a trajectory observable

Select **Solvent-accessible surface area (SASA)** and choose a pocket, highlighted residues, or a custom residue set. The observable sums the heavy-atom SASA of the selected residues in Å² in each retained frame. The Shrake–Rupley calculation uses a 1.4 Å probe and 120 sphere points per atom, with the surrounding protein included as shielding. This tracks exposure of a fixed residue group and can be compared across clusters. It uses every frame retained by the Conformations stride and frame cap, with no additional SASA subsampling.

Choose **Radius of gyration** to measure compactness for all mapped residues or a selected group. The app uses the masses of the selected atoms and their distances from the group’s center of mass. Values are reported in Å for every retained frame. Keep the measured group whole across periodic boundaries.

### Cluster differences and PCA landscape

Choose **Principal component score** to use any retained PC as an observable. It can color the projection or serve as the target for residue association. The cluster table treats these scores descriptively because those PCs were used to build the clusters.

The observable table shows the mean ± sample SD and median for each cluster. Scalar observables also have an exportable box plot with quartiles, median, min–max whiskers, and a separate mean ± SD marker. Dihedrals use circular mean ± circular SD and resultant length. For scalar observables, the pairwise table shows the difference in means in the original unit and in units of the RMS of the two within-cluster SDs. The latter helps distinguish a large shift from wide within-cluster spread. For more than 24 clusters, choose one cluster to compare with the others.

**Test cluster differences** optionally adds pairwise Welch p-values with Holm adjustment across the displayed family of comparisons. There is no equal frame-spacing requirement. The tests assume independent observations and are exploratory when applied to correlated MD frames or clusters discovered in the same data. They compare means. SD describes within-cluster spread. Tests require at least five frames per cluster and nonzero variance in at least one cluster. PC and angular observables are summarized descriptively.

The **PCA free-energy landscape** uses a two-dimensional histogram of all retained frames on the displayed axes. Select the bin count (up to 128 per axis) and temperature to calculate apparent relative free energy, `ΔF = −RT ln(p/p_max)`, from the raw bin counts. **Interpolate display** fills empty bin centers with the highest sampled free energy for rendering only and bilinearly interpolates the full display. It uses the default gnuplot palette. Turn interpolation off to show raw bins with empty bins in gray. Hover reports the raw count and the apparent free energy for sampled bins. The plot exports as SVG or PNG. Unweighted biased sampling yields an occupancy landscape. Thermodynamic free energies require equilibrium sampling or appropriate reweighting.

### Residue–observable association

After calculating a trajectory observable, choose **Rank residues**. The residue feature can be minimum Cα distance to a reference region, number of Cα neighbors within a cutoff, the magnitude of each Cα displacement from the aligned reference, or per-residue solvent-accessible surface area (SASA). SASA uses the existing heavy-atom Shrake–Rupley calculation with protein shielding, a 1.4 Å probe, and 120 sphere points. The adjustable frame cap defaults to 100. If the selected ensemble exceeds the cap, frames are sampled at evenly spaced positions in the selected frame list and SASA is paired with the observable from the same frames. Cluster frames can be unevenly spaced in time. Use all retained frames or a selected cluster with at least 20 frames. Reference residues are excluded from their own distance ranking. The default also excludes residues that define the observable to reduce direct overlap. Select residue rows and click **Use selected residues as Region A** to open Communication with those residues and the PCA trajectory inputs. This clears Region B, the functional reference, and any previously transferred cluster frame restriction, so the default search uses the full retained ensemble.

For scalar observables the ranking uses absolute Spearman ρ and shows its sign. For dihedrals it shows separate coefficients for sine and cosine and ranks by the larger magnitude. Undefined coefficients, including those for constant residue features, are unranked. Click each residue you want to toggle in the frame viewer, or export the ranking as CSV. Scores describe association over the sampled frames. A shared reference or shared geometry can contribute to the observed association.

## Exporting the 3D scene

Choose **Save PNG** under **Display and export** to save the main 3D viewer with its orientation, zoom, and visible styling and overlays. The **PNG export DPI** in **Global settings** applies to both the viewer and analysis plots. The default is 300 DPI. Raising it renders more pixels at the same nominal output size and records the selected density in the PNG. SVG exports remain scalable.

**Export VMD** creates a self-contained Tcl script. In the VMD Tk Console, enter `source {/path/to/allosteric_scene.tcl}`. **Export PyMOL** creates a Python script. In the PyMOL command line, enter `run /path/to/allosteric_scene.py`. Each script embeds the displayed structure and recreates the visible residue styles, pocket beads, selected path, and highlight labels. The target viewer fits its own camera. Surface appearance and VMD colors may differ because the viewers use different rendering and color scales.

In **Display and export**, the main viewer offers Cartoon, Surface, Sticks, and Cartoon + surface. **Color by** defaults to chain or segment. On the Communication or Perturbation tab, select signed correlation to Region A or PRS response when those results are available. Signed correlation uses blue for negative values, near-white at zero, and red for positive values. Under **Color by**, adjust **Full blue at r** and **Full red at r** independently to emphasize either sign. Values beyond each limit saturate. **Reset scale** restores −1 and +1. The legend reports the selected limits, and scene exports carry the display scaling. For **PRS response**, the **Full red at** slider sets saturation at 1–100% of the maximum displayed response (default 100%). Lower values emphasize weaker responses. The legend reports the corresponding RMS response in model units; the limit follows the current push and responder scope. **Reset scale** restores 100%. This display setting affects viewer colors and scene exports; numerical results, plots, and rankings remain unchanged. Each residue is colored by its mean signed correlation with Region A, so opposing correlations within Region A can cancel. Coloring applies to the selected representation, including its surface. The coloring method is remembered separately for each tab during the session, and correlation and PRS slider values are retained when switching tabs. If results are unavailable, the viewer temporarily uses chain colors and restores the chosen method when results become available. **Clear** resets these preferences and scales. Choose a dark or white background for the viewer and its PNG export.

Use **Overlays** to toggle pocket lining sticks, fpocket beads, reference lining, **Pocket residue labels**, and **Highlighted residue labels** independently. Pocket labels apply to visible pockets and follow the previewed frame. A residue shared by multiple pockets gets one label. With a surface visible, the **Surface transparency** slider runs from opaque (0%) to invisible (100%). Scene exports carry the selected surface transparency. The conformation frame viewer has its own residue-label toggle. The frame viewer in **Conformations** has an independent highlight field, initialized from the main viewer. **Use main highlights** copies them again. Highlights follow the current frame's coordinates and are included in its scene export.

## Choosing a clustering method

**K-means** and **Ward hierarchical** accept 2–24 clusters. Clustering can use up to 20 leading PCs when the retained features and frames support them. **DBSCAN** uses a neighborhood radius and minimum samples. Its radius ε is in units of the root-mean-square radius of the full retained PC projection. This common scaling preserves the relative variance of the PCs. Smaller ε or more minimum samples usually makes the density requirement more restrictive. Inspect the number of unassigned frames and how the observable distributions change across settings. Unassigned frames can be inspected and exported. Communication transfer is available for assigned clusters with at least 20 retained frames.

## Interpreting communication strength

The default network filters retain pairs that are closer than 8 Å for at least 60% of the analyzed frames and have `|r| ≥ 0.30`. Those are edge inclusion settings. Compare paths under the same network definitions. Lower cost favors persistent, strongly coupled edges and penalizes additional steps. Open **Path edge values** to inspect the weakest edge as well as the total cost. Check whether alternate routes share the same bottleneck and whether the finding recurs across trajectory subsets or independent runs.

For a conformational-change hypothesis, choose structural features relevant to the motion, inspect representative frames, and verify the difference with a physical observable. In SplC, try loop-focused φ/ψ PCA and measure the minimum distance from the loop to the catalytic triad. Inspect the observable distribution for each cluster before labeling groups as open or closed. Transfer each cluster to Communication and compare edge occupancies, signed correlations, and routes under the same settings. These analyses characterize structural differences and state-dependent coupling. Testing a causal mechanism requires perturbation evidence.

## Perturbation–response scanning

In **Perturbation**, choose **What responds to this push?** to see which residues move in response to pushes at a pocket or another source selection. Pocket scans initially display responses outside that pocket. Choose **Which pushes affect this region?** to rank pushes by RMS displacement within a monitored region such as the active site. In either workflow, the available groups are all mapped Cα nodes, detected pockets, custom residues, and a path transferred with **Send path to Perturbation**. Use the loaded structure or a cluster representative. Each source is pushed individually and both rankings exclude self-response.

**Show responses in** controls which residues appear in the responder table, plot, response coloring, pocket summary, picker, and responder CSV. Change the scope without rerunning the scan. The results show pocket memberships and Cα distances to the nearest scanned source for a combined map, or to the displayed source for an individual push. Choose a residue and select **Which pushes drive this response?** to rank sources by their response at that residue. Selecting the residue in the plot or table opens the same ranking. Choose a source from the ranking to see its individual response. **Reset to combined response** restores the aggregate map and clears the inspected responder. Colors scale to the displayed scores.

The scan uses a Cα anisotropic elastic network from the displayed reference structure. It uses the positive modes of the unit-spring Hessian and averages over isotropic force directions. The scores are in relative model units. A transferred path specifies source residues, and the elastic network spans the structure. A pocket or path scan applies independent perturbations to the selected residues. The scan requires no trajectory.

The **Pocket response** chart ranks detected pockets by the mean of the displayed RMS responses of their lining residues. It follows the aggregate or individual-source map and shows the number of scored residues in each pocket within the current responder scope.

A residue that ranks highly across many different sources is broadly sensitive in that elastic network. A soft collective mode can move the same loop or terminus under many different pushes. Compare numeric scores and the lead over other responders, then check whether the ranking persists across nearby network cutoffs and representative conformations. Use the full scan as a baseline when asking whether one pocket produces an unusually strong response at that residue.

## Exporting plot data

Exports are saved in the directory from which Allosteric Explorer was launched. In server mode, that directory is on the server. The app reports the saved path and adds a numbered suffix when the filename is already in use. If the working directory cannot be used, choose **Save as…** to open the desktop or browser save dialog. Browsers without a file picker offer **Download**.

Use **CSV** next to **SVG** and **PNG** on any analysis plot to export the data for that figure. The export follows the displayed series, axes, and subsets. Observable histograms include bin edges, counts and fractions. Landscape exports include both PC bin edges, raw counts, and apparent free energies, with empty energies left blank. The interpolation preference and display cap are recorded separately. Box-plot CSVs contain the individual frame values and cluster labels. Pocket-tracking exports retain frame −1 and blank volume values so plot gaps can be reconstructed. The analysis-level CSV and JSON downloads provide broader tables and run settings.

## Comparing state contacts

Run clustering in **Conformations**, expand **Compare state contacts**, and choose two assigned clusters. For each residue group, choose all mapped residues, a detected pocket, custom residues, or an available Communication region. **Use Communication regions** selects Region A and Region B where available. **Only edges on the selected path** uses the active Communication path. Use a pre-imaged trajectory. For each residue pair, occupancy is the fraction of frames with its Cα distance below the same cutoff in both clusters. The app reports B minus A in percentage points. The heatmap and table link to the two representatives. Rotating, panning, or zooming either representative updates both views. Apply custom residue highlights to both viewers, or use the current frame highlights. Selecting a contact pair keeps those highlights visible. The plot’s **CSV** exports the heatmap grid, with blank values for gray cells. **Export all contact pairs CSV** exports the pair table. For group comparisons, pairs appear in the table if a contact was observed in either state. Path comparisons also report path edges with zero occupancy in both states.
