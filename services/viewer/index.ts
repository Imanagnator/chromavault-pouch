// Viewer runtime bundle. Each module is plain browser JS imported as a raw string and
// inlined into every generated pouch (fully offline, no external requests).
import core from "./core.js?raw";
import shell from "./shell.js?raw";
import highlight from "./highlight.js?raw";
import markdown from "./markdown.js?raw";
import formats from "./formats.js?raw";
import text from "./text.js?raw";
import audio from "./audio.js?raw";
import video from "./video.js?raw";
import image from "./image.js?raw";
import pdfview from "./pdfview.js?raw";
import viewerCss from "./viewer.css?raw";

const MODULES: string[] = [core, shell, highlight, markdown, formats, text, audio, video, image, pdfview];
export const registerViewerModule = (src: string) => MODULES.push(src);

export const VIEWER_CSS: string = viewerCss;
export const VIEWER_JS: string = MODULES.join("\n;\n").replace(/<\/script/gi, "<\\/script");
