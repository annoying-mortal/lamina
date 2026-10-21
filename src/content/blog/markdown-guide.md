---
id: EXAMPLE-MARKDOWN
slug: markdown-guide
title: Markdown Guide
summary: A working example of headings, lists, links, images, code, tables, footnotes, formulas, and HTML.
categoryId: engineering
date: 2000-01-02
tags:
  - markdown
  - example
demo: true
draft: false
---

This example is also an editable Markdown file. Open `src/content/blog/markdown-guide.md` or edit **Markdown Guide** in the CMS to see the source behind each example. The date and content are sample data.

The page supports CommonMark, GitHub Flavored Markdown, footnotes, mathematical notation, and HTML. 中文排版示例：记录想法，整理阅读，让文字回到内容本身。

## Text and paragraphs

A blank line starts a new paragraph. These are *italic*, **bold**, ***bold italic***, and ~~strikethrough~~ text. The alternative spellings are _italic_ and __bold__.

A soft line break
stays in the same paragraph. Two trailing spaces create a hard break here:  
This is the next line. A trailing backslash also creates a break:\
This is another line in the same paragraph.

Inline code looks like `const ready = true`. Double backticks allow a backtick inside: `` `inline code` ``. Code keeps symbols such as `$price`, `<tag>`, and `*` literal.

Escapes keep punctuation visible: \*not italic\*, \# not a heading, \[not a link\], and \\ a backslash. HTML entities work too: &copy; &amp; &lt; &gt; &nbsp; &mdash;.

<!-- This comment is visible in the source file, but not in the article. -->

## Heading levels

The article title at the top is the level-one heading. Its text comes from frontmatter; use levels two and three in the body for the table of contents. In a standalone Markdown document, level one can be written as `# Heading one` or with an equals-sign underline:

```markdown
# Heading one

Heading one
===========
```

## Heading two

### Heading three

#### Heading four

##### Heading five

###### Heading six

Setext heading two
------------------

Both `#` prefixes and the underlined Setext syntax create headings.

## Lists and tasks

- An unordered item.
- Another item with **emphasis**.
  - A nested item.
  - A second nested item.
    1. A numbered item inside the nested list.
    2. Another numbered item.

1. First step.
2. Second step.

   A second paragraph belongs to the second step because it is indented.

   > A quotation can also belong to a list item.

3. Third step.

A separate list can start at a different number:

7. An ordered list may begin at a different number.
8. Its numbering continues automatically.

- [x] Read the example.
- [ ] Replace the sample title and summary.
- [ ] Write and publish your own post.
  - [ ] Add an image if useful.

## Quotations and separators

> A quotation is introduced with `>`.
>
> It can contain multiple paragraphs, **formatted text**, and a [link](https://example.com/).
>
> > A second `>` creates a nested quotation.

Thematic breaks can be written with three hyphens, asterisks, or underscores:

---

***

___

## Links

Use an [inline link](https://example.com/ "Example website"), a [reference link][example-site], or a collapsed reference [Example site][]. The shortcut reference is [Example site].

Angle brackets create an automatic link: <https://example.com/>. GFM also recognizes a bare URL: https://example.com/.

Email links work as `<hello@example.com>`: <hello@example.com>. This address is a placeholder.

Relative links can open [Library](/library/), the [blank post template](/blog/enter-title/), or a section of this page: [Code blocks](#code-blocks).

[example-site]: https://example.com/ "Reference link title"
[Example site]: https://example.com/

## Images

An image from this site's `public/images` directory:

![A geometric orbit diagram with an orbiting point and fine reference lines.](/images/markdown-example.svg "Local SVG example")

The source is `![Description](/images/markdown-example.svg)`. Files uploaded in the CMS use the same form with a `/uploads/…` path.

An image referenced directly from a remote image host:

![To the Moon original soundtrack cover.](https://f4.bcbits.com/img/a1974877315_5.jpg "To the Moon OST")

Cover source: [the official To the Moon soundtrack page](https://freebirdgames.bandcamp.com/album/to-the-moon-ost), by Kan R. Gao, featuring Laura Shigihara. This is an external image URL; the file is not bundled with the template.

Reference-style images use the same definition pattern as links:

![The local orbit diagram, displayed through a reference.][orbit-image]

[orbit-image]: /images/markdown-example.svg "Reference image example"

An image can also be a link:

[![Open the local diagram in its own tab.](/images/markdown-example.svg)](/images/markdown-example.svg)

## Code blocks

Add a language immediately after the opening fence. The code frame displays that language at the upper left and **Copy** at the upper right. Copy copies only the code.

### Python

```python
from pathlib import Path

def list_posts(directory: str) -> list[str]:
    return sorted(path.stem for path in Path(directory).glob("*.md"))

for title in list_posts("src/content/blog"):
    print(title)
```

### Bash

```bash
# Preview the site locally.
npm install
npm run dev

# Build the static website.
npm run build
```

### Other languages

```javascript
const post = { title: "Enter Title", published: true };
console.log(`${post.title}: ${post.published ? "public" : "draft"}`);
```

```json
{
  "title": "Enter Title",
  "tags": ["Enter tag"],
  "draft": false
}
```

~~~css
.article {
  max-width: 72ch;
  line-height: 1.8;
}
~~~

Tildes can form a fence too, as in the CSS example. A fence without a language uses the label `text`:

```
Plain text stays literal.
<tag> **not bold** $not-math$
```

Indenting by four spaces also produces a plain code block:

    This is an indented code block.
    Symbols remain literal: < > & * $.

Use a longer outer fence to display Markdown that contains its own fences:

````markdown
## Enter heading

```python
print("Hello, world!")
```
````

## Tables

Colons in the separator row control alignment. Escape a pipe when it belongs inside a cell.

| Feature | Example | Status |
| :--- | :---: | ---: |
| Left-aligned text | **Centered** | 12 |
| [Link](https://example.com/) | `inline code` | 3 |
| Escaped pipe: \| | ~~Deleted~~ | 100 |

## Footnotes

Footnotes keep supporting details out of the paragraph.[^simple] A longer footnote can contain multiple paragraphs and a list.[^long]

The same note can be referenced again.[^simple] Use its return arrow to come back to the text.

[^simple]: This is a short footnote with an [example link](https://example.com/).

[^long]: The first paragraph of a longer footnote.

    This is the second paragraph. Its indentation keeps it inside the note.

    - A list item in the footnote.
    - Another item with `inline code`.

## Mathematics

Inline formulas sit within a sentence: $E = mc^2$ and $\frac{1}{2} = 0.5$.

Display formulas use a pair of double-dollar delimiters on separate lines:

$$
\int_0^1 x^2\,dx = \left[\frac{x^3}{3}\right]_0^1 = \frac{1}{3}
$$

Aligned equations, matrices, subscripts, and superscripts are available:

$$
\begin{aligned}
\mathbf{A} &= \begin{bmatrix}1 & 2\\3 & 4\end{bmatrix} \\
a_n &= a_0 + nd \\
\sum_{k=1}^{n} k &= \frac{n(n+1)}{2}
\end{aligned}
$$

An escaped currency symbol is ordinary text: \$12. Formula-like text inside code stays literal: `$x^2$`.

## HTML

HTML is useful for elements with no standard Markdown syntax. Examples include <kbd>Ctrl</kbd> + <kbd>K</kbd>, <mark>highlighted text</mark>, H<sub>2</sub>O, x<sup>2</sup>, and <abbr title="HyperText Markup Language">HTML</abbr>.

<details>
<summary>Open this disclosure</summary>

Leave a blank line after the HTML tag to allow **Markdown** within the disclosure.

- A hidden-by-default list item.
- Another item with `code`.

</details>

<dl>
  <dt>Term</dt>
  <dd>A definition written with an HTML definition list.</dd>
  <dt>Another term</dt>
  <dd>Another definition.</dd>
</dl>

## Start writing

Duplicate [Enter Title](/blog/enter-title/), then choose a unique `id` and `slug`. Write in the Markdown folder or use the CMS; both edit the same content. Set `demo: false` when the post is yours, and `draft: true` while it is private.
