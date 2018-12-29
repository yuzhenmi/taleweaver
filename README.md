model module
- models the elements of a document
cursor module
- tracks cursors
- uses raw numerical positions
state module
- depends on model module
- depends on cursor module
- tracks the state of the document and cursors
- provides utility for resolving positions
- defines state transformations
view module
- depends on state module
- renders state (document and cursors) to DOM
- uses caching to optimize performance
- listens to DOM events and translates them to transformations for the state module to apply
- translates document state to lines and tokens, with dimensional properties
- builds all tokens and passes them to view components to render
- on state change, rebuild all tokens (optimize for performance) and rerender (optimize for performance)

model
  Document
  Paragraph
  Text
cursor
  Cursor
state
view
  TextStyle
  Document
  Paragraph
  LineGroup
  tokens
    TextToken
