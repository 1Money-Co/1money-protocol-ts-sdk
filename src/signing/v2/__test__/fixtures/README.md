# Batch Payment vectors

The single- and multisig base cases share one payload and one operations
oracle. The exact raw RLP operations item and its hash are externally
calculated and locked by the fixture tests.

Focused vectors cover operation ordering, zero and maximum-U256 helper
boundaries, both memo levels, and all six optional-tail shapes. The vector
data is self-contained and intentionally contains no provenance metadata.
Changing any expected value requires review together with its related test.
