# Allosteric Explorer methods template

This document provides modular Methods text for studies using Allosteric Explorer. Retain the analyses actually performed, select the applicable alternatives, and replace every [INSERT: …] field. Record the software version used in the study. Section names follow the four analysis tabs. References identify established methods and scientific libraries; app-specific definitions are described explicitly.

## Software and common input preparation

Protein structures and molecular dynamics trajectories were analyzed using Allosteric Explorer version [INSERT: release and commit; repository URL and archived release DOI]. Trajectory and topology data were read using MDAnalysis [1,2], and numerical calculations used NumPy [3] and SciPy [4]. The reference structure was [INSERT: PDB identifier, model, chains, preparation and source]. Simulations and their preparation are described [INSERT: elsewhere in the Methods or source reference]. The analyzed dataset comprised [INSERT: systems, independent replicates, sampling protocol, temperature, analyzed time intervals and trajectory output interval].

The first model of the supplied PDB was used as the structural reference. Recognized amino-acid residues and atoms with blank or A alternate-location identifiers were retained. Reference residues were matched one-to-one to topology Cα atoms using residue number, insertion code and residue name, with chain or segment identity used to resolve ambiguities. The analysis covered [INSERT: residues, chains, segment identifiers and exact topology selection]. Each mapped Cα atom defined one residue node for communication and elastic-network calculations. Recognized monatomic reference ions could be displayed for context; these were excluded from the pocket detector input and were not explicit nodes in the protein networks.

Trajectories were made whole and consistently imaged using [INSERT: procedure and software] before loading. Distances were evaluated directly from Cartesian coordinates without minimum-image corrections. Frames were selected using a stride of [INSERT: stride], starting at the first frame of the supplied trajectory. A frame cap of [INSERT: cap or no additional cap] was applied; where necessary, approximately evenly spaced entries of the strided frame list were retained. The final analysis used [INSERT: frame count and physical spacing or exact frame-index deposit]. Retained frames carried equal weight. Analyses restricted to a conformational group used its exact selected frame indices. Where required, rigid-body alignment used an equal-weight Kabsch fit [5] to the reference Cα coordinates over [INSERT: fitting residues].

## Pocket discovery

### Identification of cavities

Candidate cavities were detected with fpocket version [INSERT: version], which identifies and clusters alpha spheres derived from a Voronoi representation of protein geometry [6]. Detection was performed on [INSERT: complete protein assembly or isolated chain] using the parsed protein coordinates, with water, ligands and retained ions excluded. Minimum and maximum alpha-sphere radii, minimum alpha-sphere count, clustering distance and linkage were [INSERT: effective settings, including inherited fpocket defaults]. Pocket-lining residues were mapped to the reference residue identities. Pocket volume, pocket score and druggability score were taken from the fpocket output where available. These geometric and empirical descriptors were used to prioritize candidate cavities for subsequent analysis.

If ion proximity was inspected, ions within 5 Å of any pocket alpha-sphere center were displayed as contextual neighbors. This criterion was a geometric proximity measure and did not establish coordination or occupancy or contribute to pocket scoring.

### Persistence across sampled conformations

Pocket persistence was evaluated by repeating fpocket on [INSERT: sampled frames or sampling interval and count] using the reference scan's chain scope and detector settings. Frame structures were reconstructed from trajectory coordinates for the reference protein atoms; all reference heavy atoms in the scan scope were required. For reference lining set L₀ and a candidate lining set Lₜ, similarity was defined by the Jaccard index J = |L₀ ∩ Lₜ| / |L₀ ∪ Lₜ|. Each reference pocket was independently assigned the candidate with the highest J in each frame, provided J ≥ [INSERT: threshold]. Consequently, two reference pockets could match the same candidate.

Detection occupancy was the fraction of sampled trajectory frames with a qualifying match. Mean pocket volume was calculated only over matched frames with available volumes; unmatched frames contributed to the occupancy denominator but were not assigned zero volume. The reference PDB was excluded from these trajectory summaries. Additional snapshot scans reported all cavities detected in the selected frame. Persistence therefore measured reproducible detection under the specified geometric and matching criteria, rather than ligand occupancy.

## Communication

### Residue coupling

Communication analysis used [INSERT: displacement dynamic cross-correlation or contact-count correlation] over [INSERT: complete retained ensemble or selected conformational group]. Region A comprised [INSERT: residues or pocket lining], and [INSERT: Region B comprised …, or candidate endpoints were selected as described below].

For displacement dynamic cross-correlation, each frame was aligned to the reference using mapped Cα atoms outside Region A. Following the vector cross-correlation treatment of atomic fluctuations [7], the signed coefficient was calculated as:

rᵢⱼ = ⟨Δxᵢ · Δxⱼ⟩ / √(⟨|Δxᵢ|²⟩ ⟨|Δxⱼ|²⟩),

where Δxᵢ was the displacement from residue i's ensemble-mean aligned position and angle brackets denote an average over retained frames.

For the alternative contact-count analysis, each residue was represented by its number of other Cα atoms within d꜀ = [INSERT: cutoff in Å] in each frame. Signed coupling was the Pearson correlation between the two residue contact-count series. This app-specific representation measures covariation of local coordination; individual contact changes were evaluated separately. For either coupling definition, effectively zero-denominator correlations were assigned zero. Residue coupling to Region A was the mean absolute coefficient over A, sᵢ = (1/|A|) Σⱼ∈A |rᵢⱼ|; the corresponding signed mean was retained separately.

### Exposure and candidate selection

When endpoints were not explicitly restricted to Region B, residues outside A were filtered using [INSERT: minimum distance to A, surface or buried status, and network-reachability requirement]. Distance to A was the time average of the minimum Cα distance to any A residue in each frame. Explicit specification of Region B bypassed these candidate filters.

Where used, solvent-accessible surface area was estimated with an application implementation of the heavy-atom Shrake–Rupley method [8], a 1.4 Å solvent probe, element-specific van der Waals radii and [INSERT: sphere-point count] approximately uniform golden-angle sphere points per atom. Points shielded by another probe-expanded atom were excluded, and exposed areas were summed by residue. The shielding selection was [INSERT: exact selection]; heavy atoms of the mapped residues were also included. Areas were averaged over [INSERT: sampled SASA frames]. A mean residue area of [INSERT: threshold in Å²] defined the surface classification.

### Construction and analysis of the network

An undirected residue graph combined persistent spatial contacts with dynamical coupling, following the general framework of correlation-weighted protein networks [9]. Contact occupancy pᵢⱼ was the fraction of retained frames with Cα separation below d꜀. An edge was included when occupancy and absolute coupling were positive and met thresholds of [INSERT: minimum occupancy] and [INSERT: minimum |r|], respectively. The application-specific edge cost was:

wᵢⱼ = −ln[clip(pᵢⱼ |rᵢⱼ|, 10⁻¹², 1 − 10⁻⁹)].

NetworkX [10] was used for multi-source Dijkstra searches from Region A, minimizing the sum of edge costs to each reachable endpoint. Where requested, up to five lowest-cost loopless alternative routes were enumerated for a selected endpoint, allowing different starting residues in A but no subsequent return to A. Costs were dimensionless and depended on both individual edge strengths and route length. Reported routes were compared using the same network settings, with their individual occupancies and correlations inspected. These routes describe candidate connectivity in the sampled ensemble and do not establish causal signal transmission.

### Pocket ranking and consistency checks

Pocket participation was ranked by [INSERT: summed residue coupling, participating residue count, or full-lining mean coupling]. For the summed score, each pocket received the sum of sᵢ over distinct lining residues that satisfied the candidate filters, were reachable from A and met sᵢ ≥ [INSERT: threshold]. The score used all eligible candidates independently of the number displayed in the results table. The contributing residue count and strongest individual coupling were also inspected. Because the sum was not normalized by lining size, larger pockets could accumulate larger scores.

If the full-lining mean was used, pocket coupling was the mean |rᵢⱼ| over pairs between mapped lining residues and [INSERT: Region A or the specified functional reference]. Residues overlapping this reference were excluded from the pocket side. This score used its full mapped lining set rather than the filtered participation set. Couplings and pocket coupling ranks were recomputed for the first and second halves of the retained frame list as a descriptive consistency check. [INSERT: independent trajectory or sensitivity comparisons actually performed.] Neither agreement between halves nor a high pocket score was treated as a significance test.

## Conformations

### Principal component analysis

Conformational variation was analyzed by principal component analysis using [INSERT: Cartesian Cα coordinates, backbone dihedrals or the app's paired-distance ccPCA representation]. Cartesian PCA followed the essential-dynamics approach [11], using aligned Cα coordinates for [INSERT: feature residues] after fitting [INSERT: fit core]. Dihedral PCA [12] represented each selected backbone φ or ψ angle by its sine and cosine. Backbone continuity required consecutive topology residues within the same chain and segment and a C–N distance no greater than 2.0 Å in the first retained frame. Angles undefined in any retained frame were omitted.

For the app's contact-contact PCA (ccPCA), features were normalized distances between ordered atom pairs. The two exact MDAnalysis atom selections were [INSERT: selection 1] and [INSERT: selection 2]. With group sizes n₁ and n₂, m = min(n₁,n₂) pairs were formed. Within each group g, atoms were taken from topology order at stride floor(n_g/m), retaining the first m entries; the resulting groups were paired by position. Feature k in frame t was dₖ(t)/d̄(t), where d̄(t) was the mean over all m paired distances in that frame. This app-specific feature construction depends on the exact selections and topology ordering. It does not construct a complete matrix of binary contacts.

For all feature representations, each feature was mean-centered across frames without variance scaling. Singular value decomposition produced principal component scores UΣ. Explained variance fractions were calculated as the corresponding squared singular values divided by the sum of squares of the complete centered feature matrix. [INSERT: number of retained components and cumulative explained variance] were retained for clustering and subsequent inspection.

### Clustering and representatives

Frames were clustered using Euclidean distances in the retained PC-score space with [INSERT: k-means, Ward hierarchical clustering or DBSCAN]. For k-means, k = [INSERT: cluster count] and k-means++ initialization [13] were used; the fit with the lowest within-cluster sum of squares was selected from six seeded SciPy fits, each with 60 iterations. Ward clustering [14] used SciPy's hierarchical linkage and was cut to [INSERT: cluster count] groups. DBSCAN [15] used scikit-learn [16], with ε = [INSERT: radius] and min_samples = [INSERT: count]. Before DBSCAN, all PC scores were divided by one common scale, the root-mean-square radius of the projection; noise frames remained unassigned. The representative of each assigned cluster was the retained frame nearest its centroid in the clustering PC space. Cluster populations were fractions of the analyzed frame ensemble.

### Occupancy landscapes

An apparent relative free-energy landscape was calculated from the raw frame counts in a two-dimensional histogram of [INSERT: PC axes], using [INSERT: bin count] bins per axis and T = [INSERT: temperature in K]. For each occupied bin, ΔF = −RT ln(p/p_max), reported in kJ mol⁻¹, where p_max was the highest bin occupancy. Empty bins were masked in the raw display. If an interpolated display was used, empty-bin centers were assigned the maximum finite bin energy before bilinear interpolation; this affected display only. The calculation used unweighted frame occupancies. For ensembles without established equilibrium weighting, landscapes were interpreted as occupancy-derived representations of the sampled conformations.

### Structural observables and residue associations

Per-frame observables were [INSERT: definitions and residue groups]. Available definitions included minimum inter-group heavy-atom distance, distance between heavy-atom geometric centers, heavy-atom contact-pair counts below a specified cutoff, angles or dihedrals between group centers, aligned Cα RMSD, site SASA, mass-weighted radius of gyration, individual PC scores and external values matched by zero-based frame index. Distances and radii were reported in Å, areas in Å² and angles in degrees. Site SASA used a 1.4 Å probe, 120 sphere points per heavy atom and protein shielding in every retained frame. Radius of gyration used all atoms of the selected residues and their topology masses.

Scalar observables were summarized by cluster using the mean, sample standard deviation, median and quartiles. Box-plot whiskers represented the observed minimum and maximum. Dihedrals were summarized with circular means, circular standard deviations and mean resultant lengths. Where enabled, mean differences were also divided by the root mean square of the two cluster standard deviations.

Residues associated with [INSERT: observable] were ranked by Spearman correlation between matched-frame observable values and [INSERT: minimum Cα distance to a reference group, Cα neighbor count, aligned Cα displacement magnitude from the PDB reference, or heavy-atom SASA]. Average ranks were used for tied values. Ranking used |ρ| while retaining the signed coefficient. For dihedral observables, correlations were calculated separately against sine and cosine, and ranking used the larger absolute coefficient. Undefined coefficients were left unranked. Reference residues for distance features and [INSERT: other exclusions, including residues defining the observable] were excluded. SASA associations used [INSERT: retained or capped frame set]. These rankings describe association with the selected observable.

### Comparison of conformational groups

State contact differences were evaluated between [INSERT: cluster or state definitions] for [INSERT: residue groups or selected communication-path edges] using a common Cα cutoff of [INSERT: Å]. For each pair, the difference was 100(p_B − p_A), in percentage points. Group comparisons included pairs observed in at least one state; path comparisons retained all selected edges, including those absent in both states.

If enabled, scalar cluster means were compared with two-sided Welch tests [17] implemented in SciPy. A comparison required at least five observations in each group and nonzero variance in at least one group. Holm adjustment [18] covered [INSERT: all pairwise comparisons or comparisons against a selected anchor cluster] in the displayed comparison family. PC-score and circular-observable comparisons were descriptive. App-reported tests treated frames as independent and were interpreted as exploratory because trajectory frames may be temporally correlated and the clusters were estimated from the same data. [INSERT: any independent-replicate analysis or treatment of temporal dependence performed outside the app; otherwise omit this sentence.]

## Perturbation

### Elastic network and linear response

Perturbation–response scanning was performed on [INSERT: loaded reference structure or representative frame] using a Cα anisotropic elastic network [19] and the linear-response framework of PRS [20]. Every Cα pair within [INSERT: cutoff in Å] was connected by an identical unit spring. The Hessian H was diagonalized using SciPy, and its pseudoinverse G = H⁺ was formed from eigenmodes above max(10⁻¹⁰, 10⁻⁸λ_max). The calculation required exactly six excluded modes, corresponding to overall rigid-body motion.

The response of receiver residue j to an isotropically oriented unit force at source i was evaluated analytically as qᵢⱼ = ||Gⱼᵢ||F/√3, where Gⱼᵢ was the corresponding 3 × 3 block and ||·||F denotes the Frobenius norm. This quantity is the root-mean-square displacement magnitude averaged over isotropic force directions; no directional Monte Carlo sampling was used.

Sources were [INSERT: all residues, pocket, transferred communication path or custom selection], and the monitored target region was [INSERT: residues]. Source rankings used the root mean square of qᵢⱼ over the targets. Receiver maps used the root mean square over the selected, individually perturbed sources. Self-responses were excluded from both aggregates. A transferred path defined residue selections, while the elastic network still included the entire mapped protein. Multiple-source maps represented aggregates of separate source perturbations.

### Receiver and pocket summaries

Displayed receivers were restricted to [INSERT: all scored residues, residues outside the sources, the monitored region or a custom group]. This restriction was applied after computing responses. Pocket responses were the arithmetic mean of defined receiver scores over unique reference pocket-lining residues within the displayed scope, using [INSERT: the aggregate source map or an individual source map]. Scores were expressed in relative model units. They describe static linear mechanical susceptibility around the selected structure and do not provide temporal propagation, communication routes or an explicit simulation of ligand binding.

## Visualization and reproducibility

Protein structures, cavities, residue scores and selected paths were inspected using the app's 3Dmol.js viewer [21]. The exact input files, retained frame indices, residue and atom selections, effective analysis settings, cluster memberships, representatives and numerical outputs were deposited at [INSERT: data repository and persistent identifier]. Software and dependency versions were recorded at [INSERT: environment file or analysis deposit]. Only the analyses and options reported above were used to support the study's conclusions.

## References

1. Michaud-Agrawal N, Denning EJ, Woolf TB, Beckstein O. MDAnalysis: A toolkit for the analysis of molecular dynamics simulations. Journal of Computational Chemistry. 2011;32:2319–2327. https://doi.org/10.1002/jcc.21787

2. Gowers RJ, Linke M, Barnoud J, et al. MDAnalysis: A Python package for the rapid analysis of molecular dynamics simulations. Proceedings of the 15th Python in Science Conference. 2016:98–105. https://doi.org/10.25080/Majora-629e541a-00e

3. Harris CR, Millman KJ, van der Walt SJ, et al. Array programming with NumPy. Nature. 2020;585:357–362. https://doi.org/10.1038/s41586-020-2649-2

4. Virtanen P, Gommers R, Oliphant TE, et al. SciPy 1.0: Fundamental algorithms for scientific computing in Python. Nature Methods. 2020;17:261–272. https://doi.org/10.1038/s41592-019-0686-2

5. Kabsch W. A solution for the best rotation to relate two sets of vectors. Acta Crystallographica A. 1976;32:922–923. https://doi.org/10.1107/S0567739476001873

6. Le Guilloux V, Schmidtke P, Tufféry P. Fpocket: An open source platform for ligand pocket detection. BMC Bioinformatics. 2009;10:168. https://doi.org/10.1186/1471-2105-10-168

7. Ichiye T, Karplus M. Collective motions in proteins: A covariance analysis of atomic fluctuations in molecular dynamics and normal mode simulations. Proteins. 1991;11:205–217. https://doi.org/10.1002/prot.340110305

8. Shrake A, Rupley JA. Environment and exposure to solvent of protein atoms. Lysozyme and insulin. Journal of Molecular Biology. 1973;79:351–371. https://doi.org/10.1016/0022-2836(73)90011-9

9. Sethi A, Eargle J, Black AA, Luthey-Schulten Z. Dynamical networks in tRNA:protein complexes. Proceedings of the National Academy of Sciences USA. 2009;106:6620–6625. https://doi.org/10.1073/pnas.0810961106

10. Hagberg AA, Schult DA, Swart PJ. Exploring network structure, dynamics, and function using NetworkX. Proceedings of the 7th Python in Science Conference. 2008:11–15. https://networkx.org/documentation/stable/index.html#citing

11. Amadei A, Linssen ABM, Berendsen HJC. Essential dynamics of proteins. Proteins. 1993;17:412–425. https://doi.org/10.1002/prot.340170408

12. Altis A, Nguyen PH, Hegger R, Stock G. Dihedral angle principal component analysis of molecular dynamics simulations. Journal of Chemical Physics. 2007;126:244111. https://doi.org/10.1063/1.2746330

13. Arthur D, Vassilvitskii S. k-means++: The advantages of careful seeding. Proceedings of the Eighteenth Annual ACM-SIAM Symposium on Discrete Algorithms. 2007:1027–1035. https://theory.stanford.edu/~sergei/papers/kMeansPP-soda.pdf

14. Ward JH Jr. Hierarchical grouping to optimize an objective function. Journal of the American Statistical Association. 1963;58:236–244. https://doi.org/10.1080/01621459.1963.10500845

15. Ester M, Kriegel HP, Sander J, Xu X. A density-based algorithm for discovering clusters in large spatial databases with noise. Proceedings of the Second International Conference on Knowledge Discovery and Data Mining. 1996:226–231. https://cdn.aaai.org/KDD/1996/KDD96-037.pdf

16. Pedregosa F, Varoquaux G, Gramfort A, et al. Scikit-learn: Machine learning in Python. Journal of Machine Learning Research. 2011;12:2825–2830. https://jmlr.org/papers/v12/pedregosa11a.html

17. Welch BL. The generalization of ‘Student’s’ problem when several different population variances are involved. Biometrika. 1947;34:28–35. https://doi.org/10.1093/biomet/34.1-2.28

18. Holm S. A simple sequentially rejective multiple test procedure. Scandinavian Journal of Statistics. 1979;6:65–70. https://www.jstor.org/stable/4615733

19. Atilgan AR, Durell SR, Jernigan RL, Demirel MC, Keskin O, Bahar I. Anisotropy of fluctuation dynamics of proteins with an elastic network model. Biophysical Journal. 2001;80:505–515. https://doi.org/10.1016/S0006-3495(01)76033-X

20. Atilgan C, Atilgan AR. Perturbation-response scanning reveals ligand entry-exit mechanisms of ferric binding protein. PLoS Computational Biology. 2009;5:e1000544. https://doi.org/10.1371/journal.pcbi.1000544

21. Rego N, Koes D. 3Dmol.js: Molecular visualization with WebGL. Bioinformatics. 2015;31:1322–1324. https://doi.org/10.1093/bioinformatics/btu829

## Adaptation notes

Retain the shared preparation paragraph and the modules relevant to the published results. Remove unused algorithm alternatives, explanatory adaptation instructions and references that are no longer cited. Keep the app citation separate from citations to underlying methods. Add the archived app release citation once a DOI exists; do not substitute an invented DOI.

Record effective settings rather than relying on interface defaults. The application dependency ranges do not establish the package versions installed for an individual run. For ccPCA, preserve the exact atom selections and pairing order. For pocket ranking, specify whether a sum, a count or a full-lining mean was used. For simulations produced by adaptive reseeding, temperature excursions or another nonequilibrium protocol, explain which frames form the analyzed ensemble and justify any thermodynamic interpretation separately. The application applies uniform frame weights and does not itself reweight these ensembles.
