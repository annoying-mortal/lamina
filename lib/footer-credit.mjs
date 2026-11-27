/** @param {{name: string, footerLabel?: string}} settings */
export function footerCredit(settings) {
  const label = settings.footerLabel?.trim() || '';
  return {
    copyright: `© ${new Date().getFullYear()} ${settings.name}`,
    label,
    href: /^\p{Script=Han}+ICP备\s*\d+号(?:-\d+)?$/iu.test(label) ? 'https://beian.miit.gov.cn/' : '',
  };
}
