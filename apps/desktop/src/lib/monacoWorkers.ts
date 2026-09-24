import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

/** Load bundled, same-origin workers instead of Monaco's blob bootstrap, which
 * the desktop CSP blocks. Register before loading Monaco or creating editors. */
export function configureMonacoWorkers() {
  globalThis.MonacoEnvironment = {
    ...globalThis.MonacoEnvironment,
    getWorker(_workerId, label) {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TypeScriptWorker();
        default:
          return new EditorWorker();
      }
    },
  };
}
