import { insertNewlineKeepIndent, isolateHistory } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { ChangeSet, EditorState, Transaction, type ChangeSpec, type StateCommand } from '@codemirror/state'

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })
const emptyListMarker = /^\s*(?:>\s*)*(?:[-+*](?: \[[ xX]\])?|\d+[.)])\s*$/

function atEmptyListItems(state: EditorState) {
  return state.selection.ranges.every((range) => {
    const line = state.doc.lineAt(range.head)
    return range.empty && range.head === line.to && emptyListMarker.test(line.text)
  })
}

const continueMarkdownMarkup: StateCommand = ({ state, dispatch }) => continueMarkup({
  state,
  dispatch(transaction) {
    const extraSpacing: ChangeSpec[] = []
    transaction.changes.iterChanges((_from, _to, from, _end, inserted) => {
      // CodeMirror preserves loose-list spacing; keep the markup but insert just one newline.
      if (inserted.lines > 2 && inserted.line(1).text === '' && /^[\s>]*$/.test(inserted.line(2).text)) {
        extraSpacing.push({ from, to: from + inserted.line(2).to })
      }
    })
    const cleanup = ChangeSet.of(extraSpacing, transaction.newDoc.length)
    dispatch(state.update({
      changes: transaction.changes.compose(cleanup),
      selection: transaction.newSelection.map(cleanup),
      scrollIntoView: true,
      annotations: [Transaction.userEvent.of(atEmptyListItems(state) ? 'delete' : 'input'), isolateHistory.of('full')],
    }))
  },
})

export const continueMarkdownLine: StateCommand = (target) => {
  const { state } = target
  const withinItemBody = state.selection.ranges.some((range) => {
    const line = state.doc.lineAt(range.head)
    if (emptyListMarker.test(line.text)) return false
    for (let node = syntaxTree(state).resolveInner(range.head, -1); node.parent; node = node.parent) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false
      if (node.name === 'ListItem') {
        // Continuation lines do not create an item. The numbered line still does.
        return range.head <= node.to && node.from < line.from
      }
    }
    return false
  })
  if (withinItemBody) return insertNewlineKeepIndent({
    state,
    dispatch: (transaction) => target.dispatch(state.update(transaction, { annotations: isolateHistory.of('full') })),
  })
  return continueMarkdownMarkup(target)
}

export const renumberAfterDeletion = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || !transaction.isUserEvent('delete')) return transaction
  const tree = syntaxTree(transaction.startState)
  const visited = new Set<number>()
  const changes: ChangeSpec[] = []
  transaction.changes.iterChangedRanges((from, to) => tree.iterate({
    from, to,
    enter(node) {
      if (node.name !== 'OrderedList' || visited.has(node.from)) return
      visited.add(node.from)
      let previous = -1
      let removed = 0
      const items = node.node.getChildren('ListItem')
      // An empty item before unindented body text splits one logical list in the parser.
      // Follow only its consecutive continuation, stopping at headings, code, or other blocks.
      for (let sibling = node.node.nextSibling; sibling;) {
        const last = items.at(-1)!
        const lastMarker = last.getChild('ListMark')
        if (!lastMarker || transaction.startState.doc.sliceString(lastMarker.to, last.to).trim()) break
        if (sibling.name !== 'Paragraph') break
        while (sibling?.name === 'Paragraph') sibling = sibling.nextSibling
        if (sibling?.name !== 'OrderedList') break
        const nextItems = sibling.getChildren('ListItem')
        const nextMarker = nextItems[0]?.getChild('ListMark')
        if (!nextMarker) break
        const lastText = transaction.startState.doc.sliceString(lastMarker.from, lastMarker.to)
        const nextText = transaction.startState.doc.sliceString(nextMarker.from, nextMarker.to)
        if (Number.parseInt(nextText, 10) !== Number.parseInt(lastText, 10) + 1 || nextText.at(-1) !== lastText.at(-1)) break
        visited.add(sibling.from)
        items.push(...nextItems)
        sibling = sibling.nextSibling
      }
      for (const item of items) {
        const marker = item.getChild('ListMark')
        if (!marker) continue
        const oldMarker = transaction.startState.doc.sliceString(marker.from, marker.to)
        const number = Number.parseInt(oldMarker, 10)
        // Keep intentionally restarted or nonconsecutive sequences unchanged.
        if (number !== previous + 1) removed = 0
        previous = number
        const start = transaction.changes.mapPos(marker.from, -1)
        const end = transaction.changes.mapPos(marker.to, 1)
        const newMarker = transaction.newDoc.sliceString(start, end)
        const line = transaction.newDoc.lineAt(start)
        const remains = /^\d+[.)]$/.test(newMarker)
          && /^[\s>]*$/.test(transaction.newDoc.sliceString(line.from, start))
          && (end === line.to || /\s/.test(transaction.newDoc.sliceString(end, end + 1)))
        if (!remains) {
          removed++
        } else if (removed && newMarker === oldMarker) {
          // The empty-item command may already have adjusted this number.
          changes.push({ from: start, to: end - 1, insert: String(number - removed) })
        }
      }
    },
  }))
  // Keep the deletion and its numbering correction in one undo step.
  return changes.length ? [transaction, { changes, sequential: true, annotations: isolateHistory.of('full') }] : transaction
})

export const removeMarkdownMarker: StateCommand = (target) => {
  // Let the Markdown command also restore following numbers when exiting an empty item.
  if (atEmptyListItems(target.state) && continueMarkdownMarkup(target)) return true
  const { state, dispatch } = target
  return deleteMarkupBackward({
    state,
    dispatch(transaction) {
      const changes: ChangeSpec[] = []
      transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
        // Remove the marker outright instead of replacing it with invisible indentation.
        changes.push({ from, to, insert: inserted.toString().trim() ? inserted : '' })
      })
      const replacement = state.changes(changes)
      dispatch(state.update({
        changes: replacement,
        selection: state.selection.map(replacement),
        scrollIntoView: true,
        annotations: [Transaction.userEvent.of('delete'), isolateHistory.of('full')],
      }))
    },
  })
}
