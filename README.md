# ECSBatchCity

Amazon ECSの`RunTask`からFargateコンテナを起動し、Java 21上のSpring Boot / Spring Batch TaskletがMyBatisとAWS Advanced JDBC Wrapperを経由してAurora PostgreSQLへアクセスし、終了コードがECSへ伝わるまでを3Dで学ぶためのプロジェクトです。

## Status

設計準備中です。実装範囲、状態モデル、テスト要件は[実装指示書](IMPLEMENTATION_BRIEF.md)を参照してください。

## Planned stack

- TypeScript
- Three.js
- Vite
- Vitest
- Java 21の実行モデル
- Spring Boot / Spring Batch Taskletの実行モデル
- MyBatis
- AWS Advanced JDBC Wrapper
- Aurora PostgreSQL

MVPは静的なブラウザシミュレーターとして実装し、AWS認証情報や実AWS環境を必要としない構成にします。
