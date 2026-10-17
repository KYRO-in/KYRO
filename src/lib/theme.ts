export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "kayyro-theme";

/** Inline script for root layout - prevents flash before hydration. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}else{document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';}}catch(e){}})();`;
