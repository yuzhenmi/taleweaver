# State

This module is responsible for tracking the overall state of the editor, using state models from the model and cursor modules. It also provides utility functions for resolving positions and performing state transformations.

To support collaborative editing, transformations need to be compatible with operational transformation (OT). There may be multiple cursors on a document, some may be editing cursors, others may be observing cursors.
