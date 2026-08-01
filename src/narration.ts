import type { SimulationState } from './sim/types'

// 実行中、phaseに合わせて表示する紙芝居カード。simulation snapshotだけから
// 導出する純粋関数(presentationはここを表示するのみ)。
export interface NarrationCard {
  title: string
  body: string
  tone: 'info' | 'success' | 'warning' | 'error'
}

export function narrationFor(state: SimulationState): NarrationCard | null {
  const batch = state.executorType === 'BATCH'
  switch (state.phase) {
    case 'IDLE':
      return null
    case 'PROVISION_ENI':
      return { tone: 'info', title: '① RunTask受理 · ENI作成', body: 'ECS control planeがRunTaskを受け付けました。awsvpcモードなので、taskごとのENIをsubnetへ作成しています。' }
    case 'WAIT_CAPACITY':
      return { tone: 'info', title: '② Fargate capacity確保', body: 'Fargateが実行場所を確保しています。EC2インスタンスの管理は不要ですが、capacity確保の待ち時間は存在します。' }
    case 'PULL_IMAGE':
      return { tone: 'info', title: '③ container image pull', body: 'ECRからJava 21のcontainer imageをpullしています。ここで失敗するとSpringは一度も起動せずTaskFailedToStartになります。' }
    case 'START_JVM':
      return { tone: 'info', title: '④ container起動 · JVM開始', body: `containerがRUNNINGになりJVMが起動しました。認識CPUは${state.java.activeProcessorCount}(ActiveProcessorCountで固定)、GCは${state.java.gcName}が選ばれています。` }
    case 'START_SPRING':
      return { tone: 'info', title: '⑤ Spring ApplicationContext構築', body: 'Spring Bootが起動中です。ECSがRUNNINGでも、アプリの準備ができたとは限らない、という区別がここにあります。' }
    case 'START_JOB':
      return { tone: 'info', title: '⑥ JobExecution開始', body: 'Spring BatchがJobを開始し、jobRepositoryにSTARTEDを記録しました。Step transaction用のDB接続もここで取得します。' }
    case 'RUN_TASKLET':
      return batch
        ? { tone: 'info', title: '⑦ Tasklet実行 · batchへ蓄積', body: `ExecutorType.BATCHなので、Mapper呼び出しはSQLを即実行せずpending batchへ積まれます(現在pending ${state.pendingStatements}件)。MyBatis地区の琥珀の箱がその山です。` }
        : { tone: 'info', title: '⑦ Tasklet実行 · 逐次SQL', body: 'ExecutorType.SIMPLEなので、Mapper呼び出しのたびにSQLがAuroraまで流れ、update countも即確定します。' }
    case 'FLUSH_BATCH':
      return state.flushRequested
        ? { tone: 'warning', title: '⑧ flushStatements()', body: `pending ${state.pendingStatements}件をexecuteBatch()でまとめて実行します。flushはSQLの実行であって、commitではありません。` }
        : { tone: 'warning', title: '⑧ flush待機中', body: `pending ${state.pendingStatements}件が手動flushStatements()を待っています。左のボタンで実行してください。` }
    case 'FAILOVER_DETECT':
      return { tone: 'error', title: '⚠ writer障害を検出', body: 'executeBatch()中に接続が切れました。AWS Advanced JDBC Wrapperのfailover pluginが障害を検出しています。' }
    case 'TOPOLOGY_REFRESH':
      return { tone: 'error', title: '⚠ topology更新', body: 'WrapperがAuroraのtopologyを読み直し、新しいwriterを特定しています。' }
    case 'RECONNECT':
      return { tone: 'error', title: '⚠ new writerへ再接続', body: '再接続に成功しても、中断されたtransactionの結果は不明(SQLState 08007)のままです。再接続はtransactionの再実行ではありません。' }
    case 'COMMIT':
      return { tone: 'success', title: '⑨ COMMIT', body: 'TaskletはFINISHEDを返し、Spring transactionをcommitして変更が確定しました。update countの警告判定もこの後です。' }
    case 'ROLLBACK':
      return { tone: 'error', title: '⑨ ROLLBACK', body: '例外によりtransactionをrollbackしています。flush済みでも未commitの変更は確定しません。' }
    case 'CLOSE_SPRING':
      return { tone: 'info', title: '⑩ SpringApplication.exit()', body: `Job結果がSpringのexit codeへ変換されます(今回: ${state.applicationExitCode ?? 'なし'})。frameworkの状態とprocessの終了コードは別物です。` }
    case 'FORCE_KILL':
      return { tone: 'error', title: '⚠ stopTimeout待機', body: 'SIGTERMを受けてもshutdownが進まないため、ECSのstopTimeout経過後にSIGKILLされます。' }
    case 'STOP_CONTAINER':
      return { tone: 'info', title: '⑪ JVM終了', body: `container exitCode ${state.containerExitCode ?? '—'}がECSへ伝わります。ECSはこの数字しか知りません。` }
    case 'RELEASE_ENI':
      return { tone: 'info', title: '⑫ resource解放', body: 'ENIとFargate資源を解放しています。まもなくtaskはSTOPPEDになります。' }
    case 'DONE': {
      const tone = state.applicationResult === 'NORMAL' ? 'success' : state.applicationResult === 'WARNING' ? 'warning' : 'error'
      return {
        tone,
        title: `完了 · ${state.applicationResult} (${state.containerExitCode ?? '—'})`,
        body: `ECS task STOPPED · ${state.stopCode}。framework状態(${state.batchStatus})、Spring exit(${state.applicationExitCode ?? 'なし'})、container exit(${state.containerExitCode ?? 'なし'})の違いをinspectorで確認できます。`,
      }
    }
  }
}
