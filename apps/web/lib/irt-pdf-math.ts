import './irt-pdf-math-runtime';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html';
import { TeX } from 'mathjax-full/js/input/tex';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages';
import { mathjax } from 'mathjax-full/js/mathjax';
import { SVG } from 'mathjax-full/js/output/svg';

let engine: { adaptor: ReturnType<typeof liteAdaptor>; document: ReturnType<typeof mathjax.document> } | undefined;

/** Self-contained paths keep fractions and baselines intact during canvas capture. */
export function renderIrtPdfMath(latex: string, display: boolean): string {
    if (!engine) {
        const adaptor = liteAdaptor();
        RegisterHTMLHandler(adaptor);
        engine = { adaptor, document: mathjax.document('', {
            InputJax: new TeX({ packages: AllPackages }),
            OutputJax: new SVG({ fontCache: 'none' }),
        }) };
    }
    const node = engine.document.convert(display ? latex : `\\displaystyle ${latex}`, { display, em: 16, ex: 8 });
    const markup = engine.adaptor.outerHTML(node as never);
    return markup.match(/<svg[\s\S]*?<\/svg>/)?.[0] || '';
}
