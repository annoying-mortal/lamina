// Keep the label and control outside <code>, so copying never includes UI text.
// The frame is rendered with the article; only the clipboard action needs JS.
export const markdownCode = {
  name: 'article-code-controls',
  element: {
    filter: ['pre'],
    visit(node, context) {
      const code = node.children?.find(child => child.type === 'element' && child.tagName === 'code');
      if (!code) return;
      const classes = code.properties?.className;
      const languageClass = Array.isArray(classes) ? classes.find(value => String(value).startsWith('language-')) : undefined;
      const language = String(node.properties?.dataLanguage || node.properties?.['data-language'] || languageClass?.slice(9) || 'text');
      context.wrapNode(node, {
        type: 'element',
        tagName: 'div',
        properties: { className: ['code-wrapper'] },
        children: [
          {
            type: 'element', tagName: 'span',
            properties: { className: ['code-language'], ariaLabel: 'Code language' },
            children: [{ type: 'text', value: language === 'plaintext' ? 'text' : language }],
          },
          {
            type: 'element', tagName: 'button',
            properties: { className: ['copy-code'], type: 'button', ariaLabel: 'Copy code' },
            children: [{ type: 'text', value: 'Copy' }],
          },
        ],
      });
    },
  },
};
