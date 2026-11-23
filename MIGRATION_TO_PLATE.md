# Document Field Migration to PlateJS

## Problem Analysis

After analyzing your current Keystone document implementation vs. PlateJS, the core issues are:

1. **Toolbar State Disconnect**: Your toolbar uses a complex custom state system (`useToolbarState`, `createToolbarState`) that doesn't properly sync with Slate's editor state
2. **Button State Management**: Bold/italic buttons stay disabled because the `isDisabled` logic in `toolbar-state-shared.ts` is overly complex and buggy
3. **ShadCN Integration Issues**: You're manually implementing ShadCN components instead of using Plate's proven patterns
4. **Event Handling**: Inconsistent event handling between toolbar and editor
5. **Dropdown State**: Alignment dropdown and other dropdowns don't properly manage their open/closed state

## Solution: Complete UI Replacement with Plate Components

### Why Replace Instead of Fix?
- Plate has solved these problems elegantly with proper Slate integration
- Their `useMarkToolbarButton` and `useToolbarButtonState` hooks handle selection state correctly
- Their toolbar architecture is built specifically for ShadCN + Slate
- Maintaining feature parity with bug fixes would be more work than migrating

### Migration Strategy

#### Step 1: Backup Current Implementation
```bash
mv features/dashboard/views/document features/dashboard/views/document-old
```

#### Step 2: Install Plate Dependencies
```bash
npm install @udecode/plate @udecode/plate-ui @udecode/plate-basic-marks @udecode/plate-basic-nodes @udecode/plate-list @udecode/plate-alignment @udecode/plate-link
```

#### Step 3: Create New Document Implementation Based on Plate

**File Structure:**
```
features/dashboard/views/document/
├── index.tsx                    # Main field component (keep existing controller logic)
├── client/
│   ├── DocumentEditor.tsx       # New Plate-based editor
│   ├── components/
│   │   ├── PlateToolbar.tsx     # Plate toolbar with Keystone features
│   │   └── index.tsx
│   └── plates/                   # Plate-specific configurations
│       ├── create-plate-editor.ts
│       ├── plate-plugins.ts
│       └── plate-types.ts
```

#### Step 4: Key Implementation Details

**1. Editor Creation (plates/create-plate-editor.ts):**
- Use Plate's `createPlugins` with Keystone-specific configurations
- Maintain Keystone's document features but map to Plate plugins
- Preserve component block system integration

**2. Toolbar (components/PlateToolbar.tsx):**
- Use Plate's `Toolbar`, `ToolbarButton`, `MarkToolbarButton`
- Replace custom dropdown logic with Plate's `ToolbarSplitButton`
- Map Keystone features to Plate plugin states

**3. State Management:**
- Remove custom `useToolbarState`
- Use Plate's `useMarkToolbarButtonState`, `useToolbarButtonState`
- Keep Keystone's `DocumentFeatures` but map to Plate's plugin system

#### Step 5: Feature Mapping

| Keystone Feature | Plate Equivalent | Implementation |
|------------------|------------------|----------------|
| `inlineMarks.bold` | `@udecode/plate-basic-marks` | `MarkToolbarButton nodeType="bold"` |
| `inlineMarks.italic` | `@udecode/plate-basic-marks` | `MarkToolbarButton nodeType="italic"` |
| `alignment.center` | `@udecode/plate-alignment` | `AlignToolbarButton` |
| `lists.unordered` | `@udecode/plate-list` | `ListToolbarButton variant="ul"` |
| `headings` | `@udecode/plate-basic-nodes` | `TurnIntoToolbarButton` |
| Custom dropdowns | `ToolbarSplitButton` | Plate's split button pattern |

#### Step 6: Preserving Keystone Features

**Component Blocks:**
- Keep existing component block system
- Wrap with Plate's `PlateProvider`
- Maintain Keystone validation

**Document Features:**
- Convert `DocumentFeatures` to Plate plugin configurations
- Preserve all existing formatting capabilities

**Field Controller:**
- Keep existing `controller()` function unchanged
- Maintain serialization/deserialization
- Preserve validation logic

### Implementation Files to Create

#### `client/plates/plate-plugins.ts`
```typescript
import { createPlugins } from '@udecode/plate'
import { BasicMarksPlugin } from '@udecode/plate-basic-marks'
import { BasicNodesPlugin } from '@udecode/plate-basic-nodes'
// ... other Plate plugins

export const createKeystonePlugins = (documentFeatures: DocumentFeatures) => {
  return createPlugins([
    BasicNodesPlugin.configure({
      options: {
        headingLevels: documentFeatures.formatting.headingLevels
      }
    }),
    BasicMarksPlugin.configure({
      options: {
        marks: {
          bold: documentFeatures.formatting.inlineMarks.bold,
          italic: documentFeatures.formatting.inlineMarks.italic,
          // ... map other marks
        }
      }
    }),
    // ... add alignment, lists, etc based on documentFeatures
  ])
}
```

#### `client/components/PlateToolbar.tsx`
```typescript
import { MarkToolbarButton } from '@udecode/plate-ui'
import { Toolbar, ToolbarGroup } from '@/components/plate-toolbar'

export function PlateToolbar({ documentFeatures }) {
  return (
    <Toolbar>
      <ToolbarGroup>
        {documentFeatures.formatting.inlineMarks.bold && (
          <MarkToolbarButton
            nodeType="bold"
            tooltip="Bold (⌘B)"
          />
        )}
        {documentFeatures.formatting.inlineMarks.italic && (
          <MarkToolbarButton
            nodeType="italic"
            tooltip="Italic (⌘I)"
          />
        )}
        {/* ... map all other features */}
      </ToolbarGroup>
    </Toolbar>
  )
}
```

### Benefits of This Approach

1. **Eliminates Toolbar Sync Issues**: Plate's hooks properly handle editor state
2. **Proven ShadCN Integration**: Built specifically for ShadCN components
3. **Maintainable**: Uses well-maintained, tested patterns
4. **Extensible**: Easy to add new Plate features
5. **Consistent**: Same UI/UX patterns as modern editors

### Migration Timeline

1. **Phase 1**: Backup current implementation, install dependencies
2. **Phase 2**: Create basic Plate editor with toolbar
3. **Phase 3**: Migrate all formatting features
4. **Phase 4**: Integrate component blocks
5. **Phase 5**: Test and polish

### Testing Strategy

- Test all formatting features (bold, italic, alignment, etc.)
- Verify component block functionality
- Test serialization/deserialization
- Verify validation still works
- Test edge cases (empty documents, nested lists, etc.)

This migration will solve the fundamental toolbar state issues while preserving all Keystone functionality.