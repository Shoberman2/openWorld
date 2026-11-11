// The public web demo (the website): the same game, built with OPENWORLD_DEMO_BUILD=1. There is no
// GitHub, no agents and no live socket there, so the places that would connect yours point to getting
// OpenWorld instead. Always false in the game you run yourself.
declare const __OW_DEMO__: boolean;
export const DEMO = typeof __OW_DEMO__ !== 'undefined' && __OW_DEMO__;
export const REPO_URL = 'https://github.com/Shoberman2/openWorld';
/** Open the project's page (from the demo, where Settings can't connect anything). */
export const getOpenWorld = () => window.open(REPO_URL, '_blank', 'noopener');
