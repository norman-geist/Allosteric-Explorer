# Short Methods paragraph

Replace the software version and repository or DOI placeholder, and retain only analyses used in the study.

Analyses were performed using Allosteric Explorer [version; repository or DOI]. Binding pockets were identified using fpocket [1] and tracked across trajectory snapshots by pocket-lining overlap. Residue communication was assessed using MDAnalysis [2,3], displacement correlations [4] or app-specific contact-count correlations, and contact-occupancy-weighted correlation networks adapted from dynamical network analysis [5] analyzed with NetworkX [6]. Conformational ensembles were characterized using Cartesian [7], dihedral [8], or app-specific paired-distance PCA and clustering implemented with NumPy [9], SciPy [10], and scikit-learn [11]. Perturbation–response scanning used a Cα anisotropic elastic network [12] and linear-response theory [13] to identify mechanically responsive residues and pockets. Protein structures, pockets, communication paths, and residue-level scores were visualized using 3Dmol.js [14].

## References

1. Le Guilloux V, Schmidtke P, Tufféry P. Fpocket: An open source platform for ligand pocket detection. BMC Bioinformatics. 2009;10:168. https://doi.org/10.1186/1471-2105-10-168

2. Michaud-Agrawal N, Denning EJ, Woolf TB, Beckstein O. MDAnalysis: A toolkit for the analysis of molecular dynamics simulations. Journal of Computational Chemistry. 2011;32:2319–2327. https://doi.org/10.1002/jcc.21787

3. Gowers RJ, Linke M, Barnoud J, et al. MDAnalysis: A Python package for the rapid analysis of molecular dynamics simulations. Proceedings of the 15th Python in Science Conference. 2016:98–105. https://doi.org/10.25080/Majora-629e541a-00e

4. Ichiye T, Karplus M. Collective motions in proteins: A covariance analysis of atomic fluctuations in molecular dynamics and normal mode simulations. Proteins. 1991;11:205–217. https://doi.org/10.1002/prot.340110305

5. Sethi A, Eargle J, Black AA, Luthey-Schulten Z. Dynamical networks in tRNA:protein complexes. Proceedings of the National Academy of Sciences USA. 2009;106:6620–6625. https://doi.org/10.1073/pnas.0810961106

6. Hagberg AA, Schult DA, Swart PJ. Exploring network structure, dynamics, and function using NetworkX. Proceedings of the 7th Python in Science Conference. 2008:11–15. https://networkx.org/documentation/stable/index.html#citing

7. Amadei A, Linssen ABM, Berendsen HJC. Essential dynamics of proteins. Proteins. 1993;17:412–425. https://doi.org/10.1002/prot.340170408

8. Altis A, Nguyen PH, Hegger R, Stock G. Dihedral angle principal component analysis of molecular dynamics simulations. Journal of Chemical Physics. 2007;126:244111. https://doi.org/10.1063/1.2746330

9. Harris CR, Millman KJ, van der Walt SJ, et al. Array programming with NumPy. Nature. 2020;585:357–362. https://doi.org/10.1038/s41586-020-2649-2

10. Virtanen P, Gommers R, Oliphant TE, et al. SciPy 1.0: Fundamental algorithms for scientific computing in Python. Nature Methods. 2020;17:261–272. https://doi.org/10.1038/s41592-019-0686-2

11. Pedregosa F, Varoquaux G, Gramfort A, et al. Scikit-learn: Machine learning in Python. Journal of Machine Learning Research. 2011;12:2825–2830. https://jmlr.org/papers/v12/pedregosa11a.html

12. Atilgan AR, Durell SR, Jernigan RL, Demirel MC, Keskin O, Bahar I. Anisotropy of fluctuation dynamics of proteins with an elastic network model. Biophysical Journal. 2001;80:505–515. https://doi.org/10.1016/S0006-3495(01)76033-X

13. Atilgan C, Atilgan AR. Perturbation-response scanning reveals ligand entry-exit mechanisms of ferric binding protein. PLoS Computational Biology. 2009;5:e1000544. https://doi.org/10.1371/journal.pcbi.1000544

14. Rego N, Koes D. 3Dmol.js: Molecular visualization with WebGL. Bioinformatics. 2015;31:1322–1324. https://doi.org/10.1093/bioinformatics/btu829
