# Keystone Document Editor Reset Flow Analysis

## A Comprehensive PhD-Level Dissertation on Reset Functionality

**Author:** Droid AI Analysis  
**Date:** December 2024  
**Subject:** Deep Analysis of Keystone's Document Editor Reset Mechanism

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Introduction to the Problem](#introduction-to-the-problem)
3. [Keystone Architecture Overview](#keystone-architecture-overview)
4. [The Reset Button: Entry Point](#the-reset-button-entry-point)
5. [ItemForm Component: State Management](#itemform-component-state-management)
6. [Fields Component: Value Propagation](#fields-component-value-propagation)
7. [Document Field Views: The Bridge](#document-field-views-the-bridge)
8. [DocumentEditor Component](#documenteditor-component)
9. [DocumentEditorProvider: The Critical Point](#documenteditorprovider-the-critical-point)
10. [Slate's Uncontrolled Nature](#slates-uncontrolled-nature)
11. [The Mystery: Why Doesn't This Work?](#the-mystery-why-doesnt-this-work)
12. [Conclusion](#conclusion)

---

## Executive Summary

This document provides an exhaustive analysis of how Keystone CMS handles the reset functionality for its document editor field. Through careful examination of the source code from the official Keystone repository, we trace the exact flow from when a user clicks the "Reset" button to how (or if) the document editor responds.

**Key Finding:** Keystone's implementation appears to have NO explicit mechanism for syncing external value changes to the Slate editor. The `identity` used as the Slate component's `key` only depends on `[editor]`, which does NOT change when reset is clicked. This means the document editor should theoretically NOT respond to reset clicks - the same issue we faced in our implementation.

---

## Introduction to the Problem

### The Core Challenge

Rich text editors built on Slate.js present a unique challenge: Slate is fundamentally an **uncontrolled component**. Unlike a simple `<input>` element where you can set `value={state}` and expect React to control the component, Slate maintains its own internal state.

From the Slate documentation and source code:

```typescript
// From slate-react/src/components/slate.tsx
// https://github.com/ianstormtaylor/slate/blob/main/packages/slate-react/src/components/slate.tsx

export const Slate = (props) => {
  const { editor, initialValue, ... } = props

  // This useState runs ONCE on first mount only
  React.useState(() => {
    // ...validation...
    editor.children = initialValue  // Only set on first mount!
    Object.assign(editor, rest)
  })
  
  // No mechanism to sync later initialValue changes!
}
```

The `useState` with a function initializer is a React pattern that only runs **once** during the initial mount. Subsequent changes to `initialValue` are completely ignored.

### Research Questions

1. How does Keystone handle the reset button click?
2. What is the data flow from reset to the document editor?
3. Does Keystone have any special handling for external value changes?
4. If not, how does reset work (if it works at all)?

---

## Keystone Architecture Overview

### Repository Structure

Keystone's document editor implementation spans multiple packages:

- **`packages/core`**: Contains the admin UI, including ItemPage and Fields components
- **`packages/fields-document`**: Contains the DocumentEditor implementation

### Key Files Analyzed

| File | GitHub URL | Purpose |
|------|------------|---------|
| ItemPage/index.tsx | [GitHub Link](https://github.com/keystonejs/keystone/blob/main/packages/core/src/___internal-do-not-use-will-break-in-patch/admin-ui/pages/ItemPage/index.tsx) | Reset button and ItemForm |
| Fields.tsx | [GitHub Link](https://github.com/keystonejs/keystone/blob/main/packages/core/src/admin-ui/utils/Fields.tsx) | Renders field components |
| views.tsx | [GitHub Link](https://github.com/keystonejs/keystone/blob/main/packages/fields-document/src/views.tsx) | Document field view layer |
| DocumentEditor/index.tsx | [GitHub Link](https://github.com/keystonejs/keystone/blob/main/packages/fields-document/src/DocumentEditor/index.tsx) | Core editor component |

---

## The Reset Button: Entry Point

### Source Location

**File:** `packages/core/src/___internal-do-not-use-will-break-in-patch/admin-ui/pages/ItemPage/index.tsx`  
**GitHub:** https://github.com/keystonejs/keystone/blob/main/packages/core/src/___internal-do-not-use-will-break-in-patch/admin-ui/pages/ItemPage/index.tsx

### Code Analysis

```typescript
function ResetButton(props: { onReset: () => void; hasChanges?: boolean }) {
  return (
    <DialogTrigger>
      <Button tone="accent" isDisabled={!props.hasChanges}>
        Reset
      </Button>
      <AlertDialog
        title="Reset changes"
        cancelLabel="Cancel"
        primaryActionLabel="Yes, reset"
        autoFocusButton="primary"
        onPrimaryAction={props.onReset}  // ← Called when user confirms reset
      >
        Are you sure? Lost changes cannot be recovered.
      </AlertDialog>
    </DialogTrigger>
  )
}
```

### Observations

1. The Reset button is **disabled** when there are no changes (`!props.hasChanges`)
2. Clicking "Yes, reset" in the dialog calls `props.onReset`
3. The `onReset` prop comes from the parent `ItemForm` component

---

## ItemForm Component: State Management

### Source Location

Same file as above, ItemForm function.

### State Initialization

```typescript
function ItemForm({
  listKey,
  initialValue,  // ← Comes from deserializeItemToValue(list.fields, item)
  ...
}) {
  const list = useList(listKey)
  
  // State is initialized with initialValue using function initializer
  const [value, setValue] = useState(() => initialValue)
  
  // Reset function - just sets state back to initialValue
  function resetValueState() {
    setValue(() => initialValue)
  }
  
  // This effect resets when initialValue changes (e.g., after save)
  useEffect(() => resetValueState(), [initialValue])
  
  // ... later in JSX:
  <ResetButton hasChanges={hasChangedFields} onReset={resetValueState} />
  
  // Fields receive the value state
  <Fields
    ...
    onChange={useCallback(value => setValue(value), [setValue])}
    value={value}  // ← This is the state that gets reset
    ...
  />
}
```

### The initialValue Source

```typescript
// In ItemPage component:
const initialValue = useMemo(() => {
  if (!item) return null
  return deserializeItemToValue(list.fields, item)
}, [list.fields, data?.item])
```

### Critical Observations

1. **`initialValue` is memoized**: It only changes when `list.fields` or `data?.item` changes
2. **Reset does NOT change `initialValue`**: When reset is clicked, `initialValue` is the SAME reference
3. **`setValue(() => initialValue)` creates a new state**: But the document field's value is still the same REFERENCE to the same `initialValue.content` array

### The Reference Problem

```typescript
// Consider this scenario:
const initialValue = { content: [{ type: 'paragraph', children: [{ text: 'Hello' }] }] }

// User edits the document
// value.content is now a different array

// Reset is clicked
setValue(() => initialValue)
// value.content is now initialValue.content again

// BUT: Is initialValue.content === previousInitialValue.content?
// YES! It's the same memoized object
```

This means the document field receives the **same reference** as its initial value. React will see this as unchanged.

---

## Fields Component: Value Propagation

### Source Location

**File:** `packages/core/src/admin-ui/utils/Fields.tsx`  
**GitHub:** https://github.com/keystonejs/keystone/blob/main/packages/core/src/admin-ui/utils/Fields.tsx

### Code Analysis

```typescript
export function Fields({
  ...
  value: itemValue,  // ← This is the value state from ItemForm
  ...
}) {
  // For each field:
  for (const fieldKey in fields) {
    const field = fields[fieldKey]
    // ...field mode logic...
    
    const fieldValue = itemValue[fieldKey]  // ← Extract this field's value
    
    fieldDomByKey[fieldKey] = (
      <field.views.Field
        key={fieldKey}
        ...
        onChange={
          fieldMode === 'read' || onChange === undefined
            ? undefined
            : newFieldValue => {
                onChange({
                  ...itemValue,
                  [field.controller.fieldKey]: newFieldValue,
                })
              }
        }
        value={fieldValue}  // ← Document field value (Descendant[])
        ...
      />
    )
  }
}
```

### Observations

1. The field receives `fieldValue` which is `itemValue[fieldKey]` (e.g., `itemValue.content`)
2. On reset, if `itemValue.content` is the same reference, the field sees no change
3. The `key={fieldKey}` is static (e.g., "content") - it doesn't change on reset

---

## Document Field Views: The Bridge

### Source Location

**File:** `packages/fields-document/src/views.tsx`  
**GitHub:** https://github.com/keystonejs/keystone/blob/main/packages/fields-document/src/views.tsx

### Code Analysis

```typescript
export function Field(props: FieldProps<typeof controller>) {
  const { autoFocus, field, forceValidation, onChange, value } = props

  return (
    <KeystarField label={field.label} description={field.description}>
      {inputProps => (
        <ForceValidationProvider value={!!forceValidation}>
          <DocumentEditor
            {...inputProps}
            autoFocus={autoFocus}
            componentBlocks={field.componentBlocks}
            documentFeatures={field.documentFeatures}
            onChange={onChange}
            relationships={field.relationships}
            value={value}  // ← Passes value directly to DocumentEditor
          />
        </ForceValidationProvider>
      )}
    </KeystarField>
  )
}
```

### Observations

1. This is a thin wrapper that passes `value` directly to `DocumentEditor`
2. No transformation or special handling of value changes
3. No mechanism to detect or handle reset

---

## DocumentEditor Component

### Source Location

**File:** `packages/fields-document/src/DocumentEditor/index.tsx`  
**GitHub:** https://github.com/keystonejs/keystone/blob/main/packages/fields-document/src/DocumentEditor/index.tsx

### Code Analysis

```typescript
export function DocumentEditor({
  onChange,
  value,  // ← Descendant[] from Field
  componentBlocks,
  relationships,
  documentFeatures,
  ...
}) {
  // Editor is created ONCE and memoized
  const editor = useMemo(
    () => createDocumentEditor(documentFeatures, componentBlocks, relationships, {...}),
    [documentFeatures, componentBlocks, relationships]
  )

  return (
    <DocumentEditorProvider
      ...
      editor={editor}
      value={value}  // ← Passes value to provider
      ...
    >
      ...
    </DocumentEditorProvider>
  )
}
```

### Critical Observation: Editor Stability

The `editor` object is memoized with dependencies:
- `documentFeatures`
- `componentBlocks`  
- `relationships`

**None of these change when reset is clicked!**

This means:
1. `editor` stays the same object reference
2. If `identity` in DocumentEditorProvider depends on `[editor]`, it won't change
3. Slate won't remount

---

## DocumentEditorProvider: The Critical Point

### Source Location

Same file as above.

### Code Analysis

```typescript
export function DocumentEditorProvider({
  children,
  editor,
  onChange,
  value,  // ← New value after reset
  ...
}) {
  // CRITICAL: identity only depends on [editor]!
  const identity = useMemo(() => Math.random().toString(36), [editor])
  
  return (
    <Slate
      // this fixes issues with Slate crashing when a fast refresh occurs
      key={identity}      // ← KEY DOES NOT CHANGE ON RESET!
      editor={editor}
      initialValue={value}  // ← This is IGNORED after first mount
      onChange={...}
    >
      ...
    </Slate>
  )
}
```

### The Problem Exposed

1. **`identity` only depends on `[editor]`**
2. **`editor` doesn't change on reset** (same memoized object)
3. **Therefore `identity` stays the same**
4. **Therefore `<Slate key={identity}>` does NOT remount**
5. **Therefore `initialValue={value}` is IGNORED** (Slate only uses it on first mount)

### What Keystone Does NOT Have

Looking at the complete source code, Keystone's DocumentEditorProvider has:
- ✗ No `useEffect` watching for value changes
- ✗ No ref tracking to detect external changes
- ✗ No mechanism to call Slate transforms on value change
- ✗ No resetCounter or similar mechanism

---

## Slate's Uncontrolled Nature

### Source Analysis

**File:** `packages/slate-react/src/components/slate.tsx`  
**GitHub:** https://github.com/ianstormtaylor/slate/blob/main/packages/slate-react/src/components/slate.tsx

```typescript
export const Slate = (props) => {
  const { editor, children, onChange, initialValue, ... } = props

  // Run once on first mount, but before `useEffect` or render
  React.useState(() => {
    if (!Node.isNodeList(initialValue)) {
      throw new Error(`[Slate] initialValue is invalid!...`)
    }
    if (!Editor.isEditor(editor)) {
      throw new Error(`[Slate] editor is invalid!...`)
    }
    editor.children = initialValue  // ← ONLY SET ON FIRST MOUNT
    Object.assign(editor, rest)
  })

  // onChange is set via WeakMap
  useEffect(() => {
    EDITOR_TO_ON_CHANGE.set(editor, onContextChange)
    return () => {
      EDITOR_TO_ON_CHANGE.set(editor, () => {})
    }
  }, [editor, onContextChange])

  // ... rest of component
}
```

### Key Insights

1. **`useState` with function initializer runs once**: `editor.children = initialValue` only happens on mount
2. **No watcher for `initialValue` changes**: Slate doesn't have a `useEffect` that syncs `initialValue` to `editor.children`
3. **`editor.onChange()` is a no-op**: The default `onChange` in `createEditor()` is `() => {}`. The actual onChange is set via `EDITOR_TO_ON_CHANGE` WeakMap
4. **Directly setting `editor.children` doesn't trigger re-render**: You must use Slate transforms

### The createEditor Source

**File:** `packages/slate/src/create-editor.ts`  
**GitHub:** https://github.com/ianstormtaylor/slate/blob/main/packages/slate/src/create-editor.ts

```typescript
export const createEditor = (): Editor => {
  const editor: Editor = {
    children: [],
    operations: [],
    selection: null,
    marks: null,
    isElementReadOnly: () => false,
    isInline: () => false,
    isSelectable: () => true,
    isVoid: () => false,
    markableVoid: () => false,
    onChange: () => {},  // ← NO-OP!
    // ... transforms
  }
  return editor
}
```

---

## The Mystery: Why Doesn't This Work?

### Hypothesis 1: Keystone's Reset is Broken

Based on our code analysis, the most likely explanation is that **Keystone's reset functionality for document fields is simply broken** - or at least, it doesn't work as expected for the document editor.

Evidence:
- No mechanism to force Slate remount on value change
- `identity` doesn't depend on `value`
- No explicit handling for external value changes

### Hypothesis 2: Something Else Triggers Recreation

Perhaps one of the dependencies of `editor` does change:
- `documentFeatures` - Unlikely, comes from field schema
- `componentBlocks` - Unlikely, comes from field configuration  
- `relationships` - Unlikely, comes from field configuration

If any of these had new object references on reset, the editor would be recreated. But examining the data flow, none of these come from the mutable form state.

### Hypothesis 3: There's Code We Haven't Found

It's possible there's additional code that handles reset:
- A higher-order component
- A context provider
- A custom hook

However, our exhaustive search of the codebase didn't reveal any such mechanism.

### Hypothesis 4: React's Reference Comparison

When reset is clicked:
1. `setValue(() => initialValue)` is called
2. This creates a new state that holds `initialValue`
3. But `initialValue` itself hasn't changed
4. React might optimize and not re-render

However, `useState` with a function updater always causes a re-render, so this isn't the issue.

---

## Conclusion

### Summary of Findings

Through exhaustive analysis of Keystone's source code, we have determined:

1. **The Reset Button** calls `resetValueState()` which does `setValue(() => initialValue)`

2. **The ItemForm State** is reset to the memoized `initialValue`

3. **The Fields Component** passes the new value to the document field

4. **The Document Field** passes value to `DocumentEditor`

5. **DocumentEditor** passes value to `DocumentEditorProvider`

6. **DocumentEditorProvider** has `identity = useMemo(() => Math.random().toString(36), [editor])`

7. **The Key Insight**: `identity` does NOT depend on `value`, only on `editor`

8. **The Result**: Slate's `key` doesn't change, so it doesn't remount, so `initialValue` is ignored

### Implications for Our Implementation

Since Keystone doesn't appear to have a working reset mechanism for document fields, we needed to implement our own. Our solution uses:

1. A ref to track the last value we set through onChange
2. A useEffect to detect when value changes externally (not through our onChange)
3. A resetCounter state that increments on external changes
4. An identity that depends on both `editor` AND `resetCounter`

This forces Slate to remount when an external value change is detected.

### Further Research

To definitively confirm whether Keystone's reset works:
1. Clone the Keystone repository
2. Set up a test application with a document field
3. Edit the document
4. Click reset
5. Observe whether the document reverts

If the document doesn't revert, this confirms our analysis.

---

## References

1. Keystone GitHub Repository: https://github.com/keystonejs/keystone
2. Slate GitHub Repository: https://github.com/ianstormtaylor/slate
3. ItemPage Source: https://github.com/keystonejs/keystone/blob/main/packages/core/src/___internal-do-not-use-will-break-in-patch/admin-ui/pages/ItemPage/index.tsx
4. DocumentEditor Source: https://github.com/keystonejs/keystone/blob/main/packages/fields-document/src/DocumentEditor/index.tsx
5. Slate Component Source: https://github.com/ianstormtaylor/slate/blob/main/packages/slate-react/src/components/slate.tsx
6. createEditor Source: https://github.com/ianstormtaylor/slate/blob/main/packages/slate/src/create-editor.ts
