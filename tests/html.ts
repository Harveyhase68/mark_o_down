import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

/** Render Markdown to HTML for semantic comparison. */
export const toHtml = (md: string) =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ['yaml', 'toml'])
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeStringify, { allowDangerousHtml: true })
      .processSync(md),
  )
    // whitespace between block tags / line indentation inside inline HTML is irrelevant
    .replace(/\n[ \t]*/g, '\n')
    .replace(/\n+/g, '\n')
    // `***x***` nests em/strong either way; the editor has no nesting order
    .replace(/<strong><em>([^<]*)<\/em><\/strong>/g, '<em><strong>$1</strong></em>')
