import { Box } from '@chakra-ui/react'
import type { Element, Root, RootContent } from 'hast'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { caretBlink } from './chat-motion.ts'

// GFM's footnote section brings an English "Footnotes" heading (styled by a
// class this app does not define) and "↩" back-references, both links once
// unwrapped would leave as stray text.
const isFootnoteChrome = (node: Element) =>
  node.properties.dataFootnoteBackref !== undefined || node.properties.id === 'footnote-label'

/**
 * The model's links and images go (a link keeps its text), GFM's autolinked
 * addresses included, so the answer holds no links at all.
 */
function rewrite<T extends RootContent>(nodes: T[]): T[] {
  return nodes.flatMap((node): T[] => {
    if (node.type !== 'element') return [node]
    if (node.tagName === 'img' || isFootnoteChrome(node)) return []
    const children = rewrite(node.children)
    return node.tagName === 'a' ? (children as T[]) : [{ ...node, children }]
  })
}

function rehypeNoLinks() {
  return (tree: Root) => {
    tree.children = rewrite(tree.children)
  }
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeNoLinks]

const COMPONENTS: Components = {
  // A wide table scrolls inside the answer instead of widening the panel.
  table: ({ children }) => (
    <Box data-scroll="x" overflowX="auto" maxW="full">
      <table>{children}</table>
    </Box>
  ),
}

// While the answer is being written, a caret follows its last word: at the end
// of the last block, or of the last item when the answer ends in a list.
const CARET = {
  content: '""',
  display: 'inline-block',
  w: '2px',
  h: '1em',
  ms: '2px',
  verticalAlign: '-0.15em',
  borderRadius: '1px',
  bg: 'accent.solid',
  ...caretBlink,
}

/**
 * One answer as the model wrote it, in Markdown, re-rendered as tokens arrive.
 * Raw HTML is dropped, never rendered.
 */
export function ChatAnswer(props: { text: string; writing?: boolean }) {
  return (
    <Box
      data-writing={props.writing ? '' : undefined}
      fontSize="14px"
      lineHeight="1.55"
      overflowWrap="anywhere"
      css={{
        '&[data-writing] > :is(p, h1, h2, h3, h4, blockquote):last-child::after': CARET,
        '&[data-writing] > :is(ul, ol):last-child > li:last-child::after': CARET,
        '& > * + *': { mt: '8px' },
        '& ul, & ol': { ps: '20px' },
        '& ul': { listStyleType: 'disc' },
        '& ol': { listStyleType: 'decimal' },
        '& li + li': { mt: '2px' },
        '& code': {
          bg: 'bg.muted',
          borderRadius: 'stamp',
          px: '4px',
          fontFamily: 'mono',
          fontSize: '13px',
        },
        '& h1, & h2, & h3, & h4': { fontWeight: 'bold', fontSize: '15px' },
        '& table': { borderCollapse: 'collapse', fontSize: '13px', minW: 'full' },
        '& th, & td': {
          borderWidth: '1px',
          borderColor: 'border',
          px: '8px',
          py: '4px',
          textAlign: 'start',
          verticalAlign: 'top',
          overflowWrap: 'normal',
        },
        // A table's header as the ticket table draws it: mono capitals in Ink 2 on a Card.
        '& th': {
          bg: 'bg.subtle',
          color: 'fg.muted',
          fontFamily: 'mono',
          fontSize: '11px',
          fontWeight: '600',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        },
      }}
    >
      <Markdown
        skipHtml
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {props.text}
      </Markdown>
    </Box>
  )
}
