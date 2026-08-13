// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { addDiaNode, addLabelNode, connectNodes } from '@hcb-editor/editor';
import { useEditorStore } from '@hcb-editor/ui';

describe('useEditorStore', () => {
  it('re-renders and exposes the latest state after dispatch', () => {
    const { result } = renderHook(() => useEditorStore());
    const baseCount = result.current.state.document.nodes.length; // 2（START + END）

    act(() => {
      result.current.store.dispatch(addDiaNode('你好', { x: 0, y: 0 }));
    });

    expect(result.current.state.document.nodes).toHaveLength(baseCount + 1);
    const id = result.current.state.selection.nodeId!;
    expect(result.current.state.document.nodes.find((n) => n.id === id)!.node).toEqual({ kind: 'dia', text: '你好' });
  });

  it('keeps a stable store instance across renders', () => {
    const { result, rerender } = renderHook(() => useEditorStore());
    const firstStore = result.current.store;

    rerender();

    expect(result.current.store).toBe(firstStore);
  });

  it('supports undo / redo through the store', () => {
    const { result } = renderHook(() => useEditorStore());
    const baseCount = result.current.state.document.nodes.length;

    act(() => {
      result.current.store.dispatch(addLabelNode('start', { x: 0, y: 0 }));
    });
    expect(result.current.state.document.nodes).toHaveLength(baseCount + 1);

    act(() => {
      expect(result.current.store.undo()).toBe(true);
    });
    expect(result.current.state.document.nodes).toHaveLength(baseCount);

    act(() => {
      expect(result.current.store.redo()).toBe(true);
    });
    expect(result.current.state.document.nodes).toHaveLength(baseCount + 1);
  });

  it('wires a next connection between two labels', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.store.dispatch(addLabelNode('a', { x: 0, y: 0 }));
    });
    const a = result.current.state.selection.nodeId!;
    act(() => {
      result.current.store.dispatch(addLabelNode('b', { x: 100, y: 0 }));
    });
    const b = result.current.state.selection.nodeId!;

    act(() => {
      result.current.store.dispatch(connectNodes(a, b, 'next'));
    });

    expect(result.current.state.document.edges).toHaveLength(1);
    expect(result.current.state.document.edges[0]!.kind).toBe('next');
  });
});
