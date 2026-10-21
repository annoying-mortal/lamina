import katex from 'katex';

function renderMath(node, displayMode) {
  return {
    type: 'html',
    value: katex.renderToString(node.value, {
      displayMode,
      output: 'htmlAndMathml',
      throwOnError: false,
      trust: false,
    }),
  };
}

// Render only parsed math nodes, preserving dollar signs inside code and links.
// Generated HTML and local fonts work without a browser-side math runtime.
export const markdownMath = {
  name: 'article-math',
  math: (node) => renderMath(node, true),
  inlineMath: (node) => renderMath(node, false),
};
