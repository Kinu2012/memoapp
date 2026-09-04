// メモアプリのメインロジック
const STORAGE_KEY = 'memoAppJsonV1';
let memos = [];
let nextId = 1;
let isReady = false;
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
  initializeApp();

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

// JSONを復元し、不正なデータは上書きせず保持する
function initializeApp() {
  isReady = false;
  setEditorEnabled(false);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let data = { version: 1, nextId: 1, memos: [] };
    if (raw !== null) {
      data = JSON.parse(raw);
      if (!data || data.version !== 1 || !Number.isSafeInteger(data.nextId) ||
          data.nextId < 1 || !Array.isArray(data.memos)) {
        throw new Error('保存データの形式が不正です');
      }
      const ids = new Set();
      for (const memo of data.memos) {
        if (!memo || !Number.isSafeInteger(memo.id) || memo.id < 1 ||
            memo.id >= data.nextId || ids.has(memo.id) ||
            typeof memo.title !== 'string' || typeof memo.content !== 'string' ||
            typeof memo.created_at !== 'string' || typeof memo.updated_at !== 'string') {
          throw new Error('メモの形式が不正です');
        }
        ids.add(memo.id);
      }
    }
    memos = data.memos;
    nextId = data.nextId;
    isReady = true;
    setEditorEnabled(true);
    createNewMemo();
    refreshMemoList();
  } catch (error) {
    console.error('保存データの読み込みに失敗しました:', error);
    updateSaveStatus('データ復元エラー');
    alert('保存データを読み込めませんでした。元データは保持しています。上書きを防ぐため編集を停止しました。');
  }
}

// メモの保存
function saveMemo() {
  if (isSaving || !isReady) return;
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
    const timestamp = new Date().toISOString();
    const memoId = editingId === null ? nextId : editingId;
    let updatedMemos;
    let updatedNextId = nextId;
    if (editingId === null) {
      if (!Number.isSafeInteger(nextId + 1)) throw new Error('ID上限に達しました');
      updatedMemos = [...memos, { id: memoId, title, content,
        created_at: timestamp, updated_at: timestamp }];
      updatedNextId++;
    } else {
      if (!memos.some(memo => memo.id === editingId)) throw new Error('メモが見つかりません');
      updatedMemos = memos.map(memo => memo.id === editingId
        ? { ...memo, title, content, updated_at: timestamp } : memo);
    }
    persistMemos(updatedMemos, updatedNextId);
    editingId = memoId;
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

// 永続化に成功してからメモリ上の状態を更新する
function persistMemos(updatedMemos, updatedNextId = nextId) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1, nextId: updatedNextId, memos: updatedMemos
  }));
  memos = updatedMemos;
  nextId = updatedNextId;
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
    const sortedMemos = [...memos].sort((a, b) => b.id - a.id);
    if (sortedMemos.length > 0) {
      sortedMemos.forEach(({ id, title }) => {
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
    const memo = memos.find(item => item.id === id);
    if (memo) {
      const { title, content } = memo;
      document.getElementById('memoTitle').value = title;
      document.getElementById('memoContent').value = content;
      document.getElementById('formTitle').textContent = 'メモを編集';
      
      editingId = id;
      rememberSavedInput();
      updateSaveStatus('');
      highlightSelectedMemo();
    }
    

  } catch (error) {
    console.error('メモの詳細取得中にエラーが発生しました:', error);
    alert('メモの読み込みに失敗しました。');
  }
}

// メモの削除
function deleteMemo(id) {
  if (!isReady) return;
  const message = editingId === id && hasUnsavedChanges()
    ? '未保存の変更も破棄されます。このメモを削除してもよろしいですか？'
    : 'このメモを削除してもよろしいですか？';
  if (!confirm(message)) return;
  
  try {
    persistMemos(memos.filter(memo => memo.id !== id));
    
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