// メモアプリのメインロジック
let db;
let editingId = null; // 編集中のメモIDを保持
let isSaving = false; // 保存中フラグ
let savedTitle = '';
let savedContent = '';

function hasUnsavedChanges() {
  return document.getElementById('memoTitle').value !== savedTitle ||
    document.getElementById('memoContent').value !== savedContent;
}

function rememberSavedInput() {
  savedTitle = document.getElementById('memoTitle').value;
  savedContent = document.getElementById('memoContent').value;
}

function confirmDiscard() {
  return !hasUnsavedChanges() || confirm('未保存の変更があります。破棄してもよろしいですか？');
}

function setEditorEnabled(enabled) {
  document.querySelectorAll('#memoForm input, #memoForm textarea, #memoForm button, #newMemoButton')
    .forEach(element => { element.disabled = !enabled; });
}

// DOMの読み込み完了後に実行
document.addEventListener('DOMContentLoaded', () => {
  setEditorEnabled(false);
  // スクリプトの読み込み失敗も初期化エラーとして扱う
  Promise.resolve().then(() => initSqlJs({
    locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${filename}`
  })).then(initializeApp)
    .catch(error => {
      console.error('SQL.jsの初期化に失敗しました:', error);
      alert('アプリケーションの初期化に失敗しました。ページを再読み込みしてください。');
    });

  // イベントリスナーの設定
  document.getElementById('saveButton').addEventListener('click', saveMemo);
  document.getElementById('newMemoButton').addEventListener('click', () => {
    if (confirmDiscard()) createNewMemo();
  });
  document.getElementById('cancelButton').addEventListener('click', cancelEdit);
  
  document.getElementById('memoForm').addEventListener('submit', event => {
    event.preventDefault();
    saveMemo();
  });
  window.addEventListener('beforeunload', event => {
    if (hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // フォーム入力変更時の状態表示
  const formInputs = document.querySelectorAll('#memoTitle, #memoContent');
  formInputs.forEach(input => {
    input.addEventListener('input', () => {
      updateSaveStatus(hasUnsavedChanges() ? '変更あり' : '');
    });
  });
});

// アプリケーションの初期化
function initializeApp(SQL) {
  try {
    // LocalStorageからデータベース復元
    const savedDb = localStorage.getItem('memoDB');
    if (savedDb !== null) {
      try {
        if (!savedDb) throw new Error('保存データが空です');
        const uInt8Array = Uint8Array.from(atob(savedDb), c => c.charCodeAt(0));
        db = new SQL.Database(uInt8Array);
        
        // 不正なDBを新規DBで上書きしない
        db.exec("SELECT id, title, content FROM memos LIMIT 0");
        const columns = db.exec("PRAGMA table_info(memos)")[0].values.map(row => row[1]);
        if (!columns.includes('created_at')) db.run("ALTER TABLE memos ADD COLUMN created_at TEXT");
        if (!columns.includes('updated_at')) db.run("ALTER TABLE memos ADD COLUMN updated_at TEXT");
      } catch (e) {
        console.error('保存されたデータベースの読み込みに失敗しました:', e);
        if (db) db.close();
        db = null;
        updateSaveStatus('データ復元エラー');
        alert('保存データを読み込めませんでした。元データは保持しています。上書きを防ぐため編集を停止しました。');
        return;
      }
    } else {
      createNewDatabase(SQL);
    }
    
    setEditorEnabled(true);
    // 新規メモ作成の状態にする
    createNewMemo();
    
    // メモリストの初期表示（データベース初期化後に実行）
    refreshMemoList();
    
  } catch (error) {
    setEditorEnabled(false);
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
  if (isSaving || !db) return;
  const title = document.getElementById('memoTitle').value;
  const content = document.getElementById('memoContent').value;
  if (!title.trim() || !content.trim()) {
    updateSaveStatus('件名と内容を入力してください');
    alert('件名と内容を入力してください');
    return;
  }
  isSaving = true;
  updateSaveStatus('保存中...');
  try {
    let nextId = editingId;
    const timestamp = new Date().toISOString();
    persistChange(() => {
      if (editingId === null) {
        db.run('INSERT INTO memos (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [title, content, timestamp, timestamp]);
        nextId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      } else {
        db.run('UPDATE memos SET title = ?, content = ?, updated_at = ? WHERE id = ?',
          [title, content, timestamp, editingId]);
      }
    });
    editingId = nextId;
    rememberSavedInput();
    document.getElementById('formTitle').textContent = 'メモを編集';
    refreshMemoList();
    updateSaveStatus('保存しました');
    highlightSelectedMemo();
  } catch (error) {
    console.error('メモの保存中にエラーが発生しました:', error);
    alert('保存できませんでした。入力内容は残っています。空き容量などを確認し、再度保存してください。');
    updateSaveStatus('保存エラー（未保存）');
  } finally {
    isSaving = false;
  }
}

// 永続化に失敗した場合は、メモリ上のDBも操作前の状態へ戻す
function persistChange(change) {
  const previous = db.export();
  const Database = db.constructor;
  try {
    change();
    saveDatabase();
  } catch (error) {
    db.close();
    db = new Database(previous);
    throw error;
  }
}

// 新規メモ作成モードに切り替え
function createNewMemo() {
  document.getElementById('memoTitle').value = '';
  document.getElementById('memoContent').value = '';
  document.getElementById('formTitle').textContent = '新規メモ';
  editingId = null;
  rememberSavedInput();
  highlightSelectedMemo();
  updateSaveStatus('');
}

// 編集キャンセル
function cancelEdit() {
  if (!confirmDiscard()) return;
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
          if (confirmDiscard()) displayMemoDetails(id);
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
      rememberSavedInput();
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
  const message = editingId === id && hasUnsavedChanges()
    ? '未保存の変更も破棄されます。このメモを削除してもよろしいですか？'
    : 'このメモを削除してもよろしいですか？';
  if (!confirm(message)) return;
  
  try {
    persistChange(() => db.run("DELETE FROM memos WHERE id = ?", [id]));
    
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
  const binaryArray = db.export();
  const chunks = [];
  for (let offset = 0; offset < binaryArray.length; offset += 8192) {
    chunks.push(String.fromCharCode(...binaryArray.subarray(offset, offset + 8192)));
  }
  localStorage.setItem('memoDB', btoa(chunks.join('')));
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