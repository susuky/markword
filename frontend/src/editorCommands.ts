import { isolateHistory } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { ChangeSet, Transaction, type ChangeSpec, type StateCommand } from '@codemirror/state'

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })

export const continueMarkdownLine: StateCommand = ({ state, dispatch }) => continueMarkup({
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
      annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')],
    }))
  },
})

export const removeMarkdownMarker: StateCommand = (target) => {
  // Let the Markdown command also restore following numbers when exiting an empty item.
  const emptyItems = target.state.selection.ranges.every((range) => {
    const line = target.state.doc.lineAt(range.head)
    return range.empty && range.head === line.to && /^\s*(?:>\s*)*(?:[-+*](?: \[[ xX]\])?|\d+[.)])\s*$/.test(line.text)
  })
  if (emptyItems && continueMarkdownLine(target)) return true
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
