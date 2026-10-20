import { describe, expect, it } from 'vitest';
import { prepareUpdateSnapshot, prepareLeaveSnapshot, SETTINGS_OPERATION } from './updateSafety';
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

describe('离开编辑前的确认保存',()=>{
  const state={operation:'',aiBusy:false,editing:false,loading:false,documentId:'isolated',revision:7,projectSaved:false,document:{schemaVersion:2 as const,image:null,editor:{...defaultEditor(),text:'尚未保存的校对'}}};
  it('即使已导出 PNG，仍要求保留可编辑快照',()=>{
    expect(prepareLeaveSnapshot({...state,operation:'复制图片'},'complete')).toMatchObject({documentId:'isolated',revision:7,projectSaved:false,empty:false});
    expect(prepareLeaveSnapshot({...state,projectSaved:true},'close')).toHaveProperty('projectSaved',true);
  });
  it('允许在 AI 运行时保护旧文档并导入，结束会话则等待任务',()=>{
    expect(prepareLeaveSnapshot({...state,aiBusy:true,operation:'导入图片'},'replace')).toHaveProperty('document');
    expect(prepareLeaveSnapshot({...state,aiBusy:true},'close')).toHaveProperty('error');
    expect(prepareLeaveSnapshot({...state,aiBusy:true,operation:'导出图片'},'complete')).toHaveProperty('error');
  });
  it.each(['editing','loading'] as const)('拒绝丢弃尚未提交的 %s 状态',key=>{
    expect(prepareLeaveSnapshot({...state,[key]:true},'replace')).toHaveProperty('error');
  });
  it('区分当前导出和其他在途操作，空白文档无需快照',()=>{
    expect(prepareLeaveSnapshot({...state,operation:'保存项目'},'close')).toHaveProperty('error');
    expect(prepareLeaveSnapshot({...state,document:{...state.document,editor:defaultEditor()}},'close')).toHaveProperty('empty',true);
  });
});
