// dsh-android-control client half — mobile layout for the DSH web GUI.
window.__ModuleLoader__.load({
	id: "dsh-android-control",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const CSS = "@media (max-width: 768px) {\n  .pI_x6G_frame { grid-template-columns: 56px minmax(0, 1fr) !important; }\n  .pI_x6G_sidebarCol {\n    position: relative;\n    width: 56px !important;\n    min-width: 56px !important;\n  }\n  .pI_x6G_frame:not([data-sidebar-collapsed]) { grid-template-columns: minmax(0, 1fr) !important; }\n  .pI_x6G_frame:not([data-sidebar-collapsed]) .pI_x6G_sidebarCol {\n    position: fixed !important;\n    top: 0 !important; left: 0 !important; bottom: 0 !important;\n    width: min(86vw, 340px) !important;\n    min-width: min(86vw, 340px) !important;\n    z-index: 120;\n    box-shadow: 0 0 24px rgba(0,0,0,0.35);\n  }\n  .pI_x6G_detailsCol {\n    position: fixed !important;\n    top: 0 !important; right: 0 !important; bottom: 0 !important;\n    width: 92vw !important;\n    z-index: 110;\n    transform: translateX(103%);\n    transition: transform 0.18s ease;\n    box-shadow: 0 0 24px rgba(0,0,0,0.35);\n  }\n  .pI_x6G_frame:not([data-details-collapsed]) .pI_x6G_detailsCol { transform: translateX(0); }\n  .pI_x6G_centerCol { min-width: 0 !important; width: 100% !important; }\n  /* settings panel: horizontal top nav + full-width content */\n  .VOzbGW_overlay { padding: 0 !important; }\n  .VOzbGW_panel {\n    width: 100vw !important;\n    max-width: 100vw !important;\n    flex-direction: column !important;\n  }\n  .VOzbGW_nav {\n    width: 100% !important;\n    min-width: 0 !important;\n    flex: 0 0 auto !important;\n    flex-direction: column !important;\n    padding: 8px 12px !important;\n    border-bottom: 1px solid var(--dsw-alias-border-l1);\n  }\n  .VOzbGW_navTitle { display: none !important; }\n  .VOzbGW_navList {\n    flex-direction: row !important;\n    overflow-x: auto !important;\n    gap: 8px !important;\n    width: 100% !important;\n  }\n  .VOzbGW_navCell {\n    flex: 0 0 auto !important;\n    width: auto !important;\n    padding: 0 14px !important;\n  }\n  .VOzbGW_content {\n    width: 100% !important;\n    min-width: 0 !important;\n    flex: 1 1 auto !important;\n    overflow-y: auto !important;\n  }\n  .VOzbGW_options { min-width: 0 !important; }\n}";
		function apply(ctx) {
			const style = document.createElement("style");
			style.setAttribute("data-plugin", "dsh-android-control");
			style.textContent = CSS;
			document.head.appendChild(style);
			return () => { style.remove(); };
		}
		exports.apply = apply;
		exports.inject = [];
		return module.exports;
	}
});
