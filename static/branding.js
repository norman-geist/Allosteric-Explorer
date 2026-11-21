"use strict";

// Branding is independent of analysis initialization and server-session setup.
(() => {
  const banner = document.getElementById("brandBanner");
  const toggle = document.getElementById("toggleBrandBanner");
  const visual = document.getElementById("brandBannerVisual");
  if (!banner || !toggle || !visual) return;
  const images = [...banner.querySelectorAll("[data-banner-panel]")];
  const descriptions = {
    pockets: ["Pocket discovery", "Discover cavities and explore candidate binding sites."],
    communication: ["Communication", "Trace residue coupling and routes between functional sites."],
    conformations: ["Conformations", "Explore structural states, collective motion, and observables."],
    perturbation: ["Perturbation response", "Explore which residues respond when a site is perturbed."],
  };
  function setPanel(panel) {
    const selected = Object.hasOwn(descriptions, panel) ? panel : "pockets";
    for (const image of images) image.hidden = image.dataset.bannerPanel !== selected;
    document.getElementById("brandSection").textContent = descriptions[selected][0];
    document.getElementById("brandDescription").textContent = descriptions[selected][1];
  }
  document.addEventListener("allosteric:panel-change", (event) => setPanel(event.detail.panel));
  setPanel("pockets");
  const key = "allosteric-explorer.banner-hidden";
  function setHidden(hidden) {
    // Collapse the illustration only; the workflow tabs remain available.
    visual.hidden = hidden;
    banner.classList.toggle("is-collapsed", hidden);
    toggle.textContent = hidden ? "Show banner" : "Hide banner";
    toggle.setAttribute("aria-expanded", String(!hidden));
  }
  try {
    setHidden(localStorage.getItem(key) === "true");
  } catch {
    setHidden(false);
  }
  toggle.addEventListener("click", () => {
    setHidden(!visual.hidden);
    try {
      localStorage.setItem(key, String(visual.hidden));
    } catch {
      // Restricted browser storage must not interrupt the workspace.
    }
  });
})();
