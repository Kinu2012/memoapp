// メモアプリのメインロジック
let db;
let editingId = null; // 編集中のメモIDを保持
let isSaving = false; // 保存中フラグ

// DOMの読み込み完了後に実行
document.addEventListener('DOMContentLoaded', () => {
  // SQL.jsの初期化
  initSqlJs({
    locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${filename}`
  }).then(initializeApp)
    .catch(error => {
      console.error('SQL.jsの初期化に失敗しました:', error);
      alert('アプリケーションの初期化に失敗しました。ページを再読み込みしてください。');
    });

  // イベントリスナーの設定
  document.getElementById('saveButton').addEventListener('click', saveMemo);
  document.getElementById('newMemoButton').addEventListener('click', createNewMemo);
  document.getElementById('cancelButton').addEventListener('click', cancelEdit);
  
  // フォーム入力変更時の自動保存状態表示
  const formInputs = document.querySelectorAll('#memoTitle, #memoContent');
  formInputs.forEach(input => {
    input.addEventListener('input', () => {
      if (editingId !== null) {
        updateSaveStatus('変更あり');
      }
    });
  });
});

// アプリケーションの初期化
function initializeApp(SQL) {
  try {
    // LocalStorageからデータベース復元
    const savedDb = localStorage.getItem('memoDB');
    if (savedDb) {
      try {
        const uInt8Array = Uint8Array.from(atob(savedDb), c => c.charCodeAt(0));
        db = new SQL.Database(uInt8Array);
        
        // テーブルが存在するか確認し、存在しなければ作成
        const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='memos'");
        if (!tableCheck.length || !tableCheck[0].values.length) {
          db.run("CREATE TABLE memos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, created_at TEXT, updated_at TEXT)");
          saveDatabase();
        }
      } catch (e) {
        console.error('保存されたデータベースの読み込みに失敗しました:', e);
        createNewDatabase(SQL);
      }
    } else {
      createNewDatabase(SQL);
    }
    
    // 新規メモ作成の状態にする
    createNewMemo();
    
    // メモリストの初期表示（データベース初期化後に実行）
    refreshMemoList();
    
  } catch (error) {
    console.error('アプリケーションの初期化中にエラーが発生しました:', error);
    alert('アプリケーションの初期化中にエラーが発生しました。ページを再読み込みしてください。');
  }
}

// 新しいデータベースの作成
function createNewDatabase(SQL) {
  db = new SQL.Database();
  // SQLiteでは単純なTEXT型を使い、TIMESTAMP型は使わない
  db.run("CREATE TABLE memos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, created_at TEXT, updated_at TEXT)");
  saveDatabase();
}

// メモの保存
function saveMemo() {
  try {
    if (isSaving) return; // 保存中は操作を受け付けない
    
    isSaving = true;
    updateSaveStatus('保存中...');
    
    const newTitle = document.getElementById('memoTitle').value.trim();
    const newContent = document.getElementById('memoContent').value.trim();
    
    if (!newTitle || !newContent) {
      alert('件名と内容を入力してください');
      isSaving = false;
      return;
    }
    
    const timestamp = new Date().toISOString();
    
    if (editingId === null) {
      // 新規メモの追加
      try {
        db.run(
          "INSERT INTO memos (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)", 
          [newTitle, newContent, timestamp, timestamp]
        );
        
        // 追加したメモのIDを取得
        const result = db.exec("SELECT last_insert_rowid()");
        if (result.length > 0) {
          editingId = result[0].values[0][0];
        }
      } catch (insertError) {
        console.error('新規メモの追加に失敗しました:', insertError);
        // シンプルな挿入を試みる
        db.run(
          "INSERT INTO memos (title, content) VALUES (?, ?)", 
          [newTitle, newContent]
        );
        const result = db.exec("SELECT last_insert_rowid()");
        if (result.length > 0) {
          editingId = result[0].values[0][0];
        }
      }
    } else {
      // 既存メモの更新
      try {
        db.run(
          "UPDATE memos SET title = ?, content = ?, updated_at = ? WHERE id = ?", 
          [newTitle, newContent, timestamp, editingId]
        );
      } catch (updateError) {
        console.error('メモの更新に失敗しました (タイムスタンプエラー):', updateError);
        // シンプルな更新を試みる
        db.run(
          "UPDATE memos SET title = ?, content = ? WHERE id = ?", 
          [newTitle, newContent, editingId]
        );
      }
    }
    
    saveDatabase();
    refreshMemoList();
    updateSaveStatus('保存しました');
    
    // 選択状態を更新
    highlightSelectedMemo();
    
  } catch (error) {
    console.error('メモの保存中にエラーが発生しました:', error);
    alert('メモの保存中にエラーが発生しました。');
    updateSaveStatus('保存エラー');
  } finally {
    isSaving = false;
  }
}

// 新規メモ作成モードに切り替え
function createNewMemo() {
  document.getElementById('memoTitle').value = '';
  document.getElementById('memoContent').value = '';
  document.getElementById('formTitle').textContent = '新規メモ';
  editingId = null;
  highlightSelectedMemo();
  updateSaveStatus('');
}

// 編集キャンセル
function cancelEdit() {
  if (editingId === null) {
    // 新規作成モードならフォームをクリア
    createNewMemo();
  } else {
    // 編集モードなら元の内容を再表示
    displayMemoDetails(editingId);
  }
}

// メモリストの更新
function refreshMemoList() {
  const list = document.getElementById('memoList');
  list.innerHTML = '';
  
  try {
    // メモを取得（更新日時でソートする代わりにID順でソート）
    const res = db.exec("SELECT id, title, content FROM memos ORDER BY id DESC");
    
    if (res.length > 0 && res[0].values.length > 0) {
      const values = res[0].values;
      
      values.forEach(row => {
        const id = row[0];
        const title = row[1];
        
        const li = document.createElement('li');
        li.dataset.id = id;
        
        // 選択中メモのハイライト
        if (editingId === id) {
          li.classList.add('selected');
        }
        
        // メモタイトル
        const titleSpan = document.createElement('span');
        titleSpan.textContent = title;
        titleSpan.className = 'memo-title';
        titleSpan.addEventListener('click', () => {
          displayMemoDetails(id);
        });
        
        // 削除ボタン
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'X';
        deleteButton.className = 'delete-button';
        deleteButton.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteMemo(id);
        });
        
        li.appendChild(titleSpan);
        li.appendChild(deleteButton);
        list.appendChild(li);
      });
    } else {
      // メモがない場合のメッセージ
      const emptyMessage = document.createElement('li');
      emptyMessage.textContent = 'メモがありません。新規作成してください。';
      emptyMessage.style.padding = '1rem';
      emptyMessage.style.textAlign = 'center';
      emptyMessage.style.color = '#757575';
      list.appendChild(emptyMessage);
    }
  } catch (error) {
    console.error('メモリストの取得中にエラーが発生しました:', error);
    const errorMessage = document.createElement('li');
    errorMessage.textContent = 'メモの読み込みに失敗しました。';
    errorMessage.style.color = 'red';
    list.appendChild(errorMessage);
  }
}

// メモの詳細表示
function displayMemoDetails(id) {
  try {
    const stmt = db.prepare("SELECT title, content FROM memos WHERE id = ?");
    stmt.bind([id]);
    const result = stmt.step();
    
    if (result) {
      const title = stmt.get()[0];
      const content = stmt.get()[1];
      
      document.getElementById('memoTitle').value = title;
      document.getElementById('memoContent').value = content;
      document.getElementById('formTitle').textContent = 'メモを編集';
      
      editingId = id;
      updateSaveStatus('');
      highlightSelectedMemo();
    }
    
    stmt.free();
  } catch (error) {
    console.error('メモの詳細取得中にエラーが発生しました:', error);
    alert('メモの読み込みに失敗しました。');
  }
}

// メモの削除
function deleteMemo(id) {
  if (!confirm('このメモを削除してもよろしいですか？')) return;
  
  try {
    db.run("DELETE FROM memos WHERE id = ?", [id]);
    saveDatabase();
    
    // 削除したメモが編集中だった場合はフォームをクリア
    if (editingId === id) {
      createNewMemo();
    }
    
    refreshMemoList();
  } catch (error) {
    console.error('メモの削除中にエラーが発生しました:', error);
    alert('メモの削除に失敗しました。');
  }
}

// 選択中のメモをハイライト表示
function highlightSelectedMemo() {
  const items = document.querySelectorAll('#memoList li');
  items.forEach(item => {
    if (item.dataset.id && parseInt(item.dataset.id) === editingId) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// データベースの保存
function saveDatabase() {
  try {
    const binaryArray = db.export();
    const base64 = btoa(String.fromCharCode.apply(null, binaryArray));
    localStorage.setItem('memoDB', base64);
  } catch (error) {
    console.error('データベースの保存中にエラーが発生しました:', error);
    alert('データの保存に失敗しました。');
  }
}

// 保存状態の表示更新
function updateSaveStatus(message) {
  const statusElement = document.getElementById('saveStatus');
  statusElement.textContent = message;
  
  // 3秒後に保存完了メッセージを消す
  if (message === '保存しました') {
    setTimeout(() => {
      if (statusElement.textContent === '保存しました') {
        statusElement.textContent = '';
      }
    }, 3000);
  }
}