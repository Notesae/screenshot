import { describe, expect, it } from 'vitest';
import { prepareUpdateSnapshot, SETTINGS_OPERATION } from './updateSafety';
import { defaultEditor } from './document';

describe('更新前保存保护', () => {
  const state = { operation: '', aiBusy: false, editing: false, loading: false, documentId: 'isolated-project', revision: 42, document: { schemaVersion: 2 as const, image: null, editor: defaultEditor() } };
  it('完整保留未手动保存的项目、修订和恢复身份', () => {
    expect(prepareUpdateSnapshot(state)).toEqual({ documentId: state.documentId, revision: 42, document: state.document });
  });
  it.each(['aiBusy', 'editing', 'loading'] as const)('%s 状态必须先结束', key => {
    expect(prepareUpdateSnapshot({ ...state, [key]: true })).toHaveProperty('error');
  });
  it('设置本身的等待不会阻止安装，其他本地操作必须先结束', () => {
    expect(prepareUpdateSnapshot({ ...state, operation: SETTINGS_OPERATION })).toHaveProperty('document');
    expect(prepareUpdateSnapshot({ ...state, operation: '保存项目' })).toHaveProperty('error');
  });
  it('空白初始文档不占用恢复容量', () => {
    expect(prepareUpdateSnapshot({ ...state, revision: 0 })).toEqual({ empty: true });
  });
});
