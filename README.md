# ECSBatchCity

Amazon ECSの`RunTask`からFargateコンテナを起動し、Java 21上のSpring Boot / Spring Batch TaskletがMyBatisとAWS Advanced JDBC Wrapperを経由してAurora PostgreSQLへアクセスし、終了コードがECSへ伝わるまでを3Dで学ぶ決定論的シミュレーターです。

公開ページ: <https://baoo-public-learning.github.io/ECSBatchCity/>

```bash
npm install
npm run dev        # 開発サーバー
npm test           # シミュレーション・UI・rendererのテスト
npm run typecheck  # vue-tsc
npm run build      # production build
```

## できること

- **9シナリオ**: 正常(0) / 警告(1) / 異常(101) / flush失敗(BatchUpdateException) / DB接続失敗 / writer failover(方針依存) / JVM OOM(3) / ECS OOM kill(137) / TaskFailedToStart
- **MyBatis ExecutorType**: SIMPLEとBATCHの実行の違い、flush thresholdごとの複数flush、手動`flushStatements()`、`BatchResult`一覧(EXECUTE_FAILED / SUCCESS_NO_INFOの区別)、`reWriteBatchedInserts`のトレードオフ
- **Aurora障害**: writer failoverの検出→topology更新→再接続、transaction LOST(SQLState 08007)、再接続≠再実行、FAIL_JOB / Tasklet再試行の2方針(attempt管理)
- **プロセス死**: `-XX:+ExitOnOutOfMemoryError`(exit 3)、ECS memory limit(SIGKILL 137)、stopTimeout後のSIGKILL。いずれもSpring exit codeを持たず101へ変換されない
- **Java 21 container設定**: Fargateの有効なCPU×メモリ組み合わせ、Initial/MaxRAMPercentage、JVM認識CPU(`-XX:ActiveProcessorCount`固定)、G1/Serial自動選択、native領域予算、メモリ設定起因OOM(flushThresholdとの連動)、GC activity
- **3D都市**: 6地区の建築(picking・camera focus・キーボード選択)、phaseごとの意味のあるフロー(rollbackは逆流)、reduced motion対応

## 設計境界

- `src/sim`はVue / Pinia / Three.js / DOMをimportしない純粋なTypeScript状態機械
- Piniaはプレーンなsnapshotを公開し、presentationはsimulation状態を変更しない
- Three.js objectはPiniaに保存しない。表示・timeline・metricsは同じsnapshotから生成する

仕様の詳細と禁止事項は[実装指示書](IMPLEMENTATION_BRIEF.md)、現在の実装状況と次の作業は[HANDOFF.md](HANDOFF.md)を参照してください。
