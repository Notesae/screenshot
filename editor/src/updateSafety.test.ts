import { describe, expect, it } from 'vitest';
import { prepareUpdateSnapshot, prepareLeaveSnapshot, SETTINGS_OPERATION } from './updateSafety';
import { defaultEditor } from './document';

describe('更新前操作状态', () => {
  const state = { operation: '', aiBusy: false, editing: false, loading: false, documentId: 'isolated-project', revision: 42, document: { schemaVersion: 2 as const, image: null, editor: defaultEditor() } };
  it('完整保留未手动保存的项目、修订和内存身份', () => {
    expect(prepareUpdateSnapshot(state)).toEqual({ documentId: state.documentId, revision: 42, document: state.document });
  });
  it.each(['aiBusy', 'editing', 'loading'] as const)('%s 状态必须先结束', key => {
    expect(prepareUpdateSnapshot({ ...state, [key]: true })).toHaveProperty('error');
  });
  it('设置本身的等待不会阻止安装，其他本地操作必须先结束', () => {
    expect(prepareUpdateSnapshot({ ...state, operation: SETTINGS_OPERATION })).toHaveProperty('document');
    expect(prepareUpdateSnapshot({ ...state, operation: '保存项目' })).toHaveProperty('error');
  });
  it('识别空白初始文档', () => {
    expect(prepareUpdateSnapshot({ ...state, revision: 0 })).toEqual({ empty: true });
  });
});

describe('离开编辑前的状态检查',()=>{
  const state={operation:'',aiBusy:false,editing:false,loading:false,documentId:'isolated',revision:7,projectSaved:false,document:{schemaVersion:2 as const,image:null,editor:{...defaultEditor(),text:'尚未保存的校对'}}};
  it('完成只提供身份与内容校验，不要求项目已保存',()=>{
    expect(prepareLeaveSnapshot({...state,operation:'完成截图'},'complete')).toMatchObject({documentId:'isolated',revision:7,projectSaved:false,empty:false});
    expect(prepareLeaveSnapshot({...state,projectSaved:true},'close')).toHaveProperty('projectSaved',true);
  });
  it('允许 AI 运行时替换文档，完成仍等待任务',()=>{
    expect(prepareLeaveSnapshot({...state,aiBusy:true,operation:'导入图片'},'replace')).toHaveProperty('document');
    expect(prepareLeaveSnapshot({...state,aiBusy:true},'close')).toHaveProperty('error');
    expect(prepareLeaveSnapshot({...state,aiBusy:true,operation:'完成截图'},'complete')).toHaveProperty('error');
  });
  it.each(['editing','loading'] as const)('拒绝丢弃尚未提交的 %s 状态',key=>{
    expect(prepareLeaveSnapshot({...state,[key]:true},'replace')).toHaveProperty('error');
  });
  it('区分完成和其他在途操作，识别空白文档',()=>{
    expect(prepareLeaveSnapshot({...state,operation:'保存项目'},'close')).toHaveProperty('error');
    expect(prepareLeaveSnapshot({...state,document:{...state.document,editor:defaultEditor()}},'close')).toHaveProperty('empty',true);
  });
});
