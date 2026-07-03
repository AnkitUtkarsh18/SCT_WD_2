/**
 * NEBULA CALC — CORE STATE & ENGINE
 * Portfolio-grade Web Calculator Logic
 * Implements: Shunting-Yard Parser, Custom Web Audio Click, Keyboard Mapping, Theme & Scientific mode toggle.
 */

// Initial App State
const state = {
  expression: '',       // Raw math string representation (e.g. '5+sqrt(25)')
  result: '0',          // Currently evaluated result or buffer
  memory: 0,            // Memory storage register
  angleMode: 'deg',     // 'deg' or 'rad' for trigonometry
  isSciMode: false,     // Scientific mode toggle state
  isSoundOn: true,      // Synthesized key-click sounds toggle
  isDarkTheme: true,    // UI theme toggle
  history: [],          // Past calculations history: { expression, result }
  isEvaluated: false    // Triggers clear on next keypress if user starts typing new numbers
};

// CSS class names mapping
const THEME_CLASS = 'light-theme';
const SCI_ACTIVE_CLASS = 'scientific-active';

// DOM Elements cache
const elExpression = document.getElementById('expression-display');
const elResult = document.getElementById('result-display');
const elMemoryIndicator = document.getElementById('indicator-memory');
const elAngleIndicator = document.getElementById('indicator-angle');
const elModeIndicator = document.getElementById('indicator-mode');

const btnToggleSci = document.getElementById('toggle-sci-btn');
const btnToggleSound = document.getElementById('toggle-sound-btn');
const btnToggleTheme = document.getElementById('toggle-theme-btn');
const btnToggleHistory = document.getElementById('toggle-history-btn');

const iconSoundOn = btnToggleSound.querySelector('.icon-sound-on');
const iconSoundOff = btnToggleSound.querySelector('.icon-sound-off');
const iconMoon = btnToggleTheme.querySelector('.icon-moon');
const iconSun = btnToggleTheme.querySelector('.icon-sun');

const panelHistory = document.getElementById('history-sidebar');
const listHistory = document.getElementById('history-list');
const btnClearHistory = document.getElementById('clear-history-btn');
const btnCloseHistory = document.getElementById('close-history-btn');

const btnCopyResult = document.getElementById('copy-result-btn');
const copyToast = document.getElementById('copy-toast');
const srAnnouncer = document.getElementById('sr-status-announcer');

// Web Audio API Synthesizer Context
let audioCtx = null;

/**
 * Initialize Web Audio API and play a subtle physical click sound
 */
function playClickSound() {
  if (!state.isSoundOn) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    // Synthesize physical key click sounds: short high frequency sine decay
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(700, audioCtx.currentTime + 0.035);
    
    gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.04);
  } catch (err) {
    console.warn('Audio Context failed to load or start:', err);
  }
}

/**
 * Screen Reader Accessible Status Announcer
 */
function announceToSR(message) {
  if (srAnnouncer) {
    srAnnouncer.textContent = message;
  }
}

/**
 * Custom math function: Factorial (safe & bounded)
 */
function factorial(n) {
  if (n < 0) throw new Error('Undefined (Negative Factorial)');
  if (!Number.isInteger(n)) throw new Error('Undefined (Fractional Factorial)');
  if (n > 170) return Infinity; // Limit JavaScript JS float overflow
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/* =========================================================================
   MATHEMATICAL EXPRESSION TOKENIZER & EVALUATOR (Shunting-Yard Implementation)
   ========================================================================= */

/**
 * Tokenize raw expression string into numeric, constant, function, operator and bracket tokens.
 */
function tokenize(expression) {
  let str = expression.replace(/\s+/g, '');
  // Sanitize math string representations
  str = str.replace(/×/g, '*');
  str = str.replace(/÷/g, '/');
  str = str.replace(/−/g, '-');
  str = str.replace(/π/g, 'PI');
  
  let i = 0;
  const tokens = [];
  
  while (i < str.length) {
    const char = str[i];
    
    // 1. Matches Decimal / Floats / Exponential Notations (e.g. 1e+5)
    const numMatch = str.slice(i).match(/^(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/);
    if (numMatch) {
      const numStr = numMatch[0];
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
      i += numStr.length;
      continue;
    }
    
    // 2. Matches Constants
    if (str.slice(i).startsWith('PI')) {
      tokens.push({ type: 'NUMBER', value: Math.PI });
      i += 2;
      continue;
    }
    
    // Euler constant 'e'. Ensures it's not part of function name (exp)
    if (char === 'e') {
      if (str.slice(i).startsWith('exp(')) {
        tokens.push({ type: 'FUNCTION', value: 'exp' });
        i += 3;
        continue;
      }
      if (!/^[a-zA-Z]/.test(str.slice(i + 1))) {
        tokens.push({ type: 'NUMBER', value: Math.E });
        i += 1;
        continue;
      }
    }
    
    // 3. Matches Functions
    const funcs = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'sqrt', 'cbrt', 'fact'];
    let matchedFunc = false;
    for (const func of funcs) {
      if (str.slice(i).startsWith(func)) {
        tokens.push({ type: 'FUNCTION', value: func });
        i += func.length;
        matchedFunc = true;
        break;
      }
    }
    if (matchedFunc) continue;
    
    // 4. Matches Brackets
    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }
    
    // 5. Matches Unary Negative Sign vs Binary Minus Operator
    if (char === '-') {
      const prev = tokens[tokens.length - 1];
      const isUnary = !prev || prev.type === 'OPERATOR' || prev.type === 'UNARY_MINUS' || prev.type === 'LPAREN' || prev.type === 'FUNCTION';
      if (isUnary) {
        tokens.push({ type: 'UNARY_MINUS', value: 'u-', precedence: 4, associativity: 'RIGHT' });
      } else {
        tokens.push({ type: 'OPERATOR', value: '-', precedence: 2, associativity: 'LEFT' });
      }
      i++;
      continue;
    }
    
    // 6. Matches standard Operators
    if (char === '+') {
      tokens.push({ type: 'OPERATOR', value: '+', precedence: 2, associativity: 'LEFT' });
      i++;
      continue;
    }
    if (char === '*') {
      tokens.push({ type: 'OPERATOR', value: '*', precedence: 3, associativity: 'LEFT' });
      i++;
      continue;
    }
    if (char === '/') {
      tokens.push({ type: 'OPERATOR', value: '/', precedence: 3, associativity: 'LEFT' });
      i++;
      continue;
    }
    if (char === '^') {
      tokens.push({ type: 'OPERATOR', value: '^', precedence: 4, associativity: 'RIGHT' });
      i++;
      continue;
    }
    
    // 7. Matches Post-fix Unary Operators (%, !)
    if (char === '%') {
      tokens.push({ type: 'POSTFIX', value: '%', precedence: 5, associativity: 'LEFT' });
      i++;
      continue;
    }
    if (char === '!') {
      tokens.push({ type: 'POSTFIX', value: '!', precedence: 5, associativity: 'LEFT' });
      i++;
      continue;
    }
    
    throw new Error(`Invalid Character: ${char}`);
  }
  
  return tokens;
}

/**
 * Preprocesses tokens array to insert implicit multiplications
 * E.g.: 2(3) -> 2*(3), 2PI -> 2*PI, (5)sin(3) -> (5)*sin(3)
 */
function insertImplicitMultiplications(tokens) {
  const processed = [];
  const leftMatchTypes = ['NUMBER', 'RPAREN', 'POSTFIX'];
  const rightMatchTypes = ['NUMBER', 'LPAREN', 'FUNCTION'];
  
  for (let i = 0; i < tokens.length; i++) {
    processed.push(tokens[i]);
    if (i < tokens.length - 1) {
      const current = tokens[i];
      const next = tokens[i + 1];
      
      const leftOk = leftMatchTypes.includes(current.type);
      const rightOk = rightMatchTypes.includes(next.type);
      
      if (leftOk && rightOk) {
        processed.push({ type: 'OPERATOR', value: '*', precedence: 3, associativity: 'LEFT' });
      }
    }
  }
  return processed;
}

/**
 * Convert Infix notation to RPN (Reverse Polish Notation) using Dijkstra's Shunting-Yard Algorithm
 */
function parseInfixToRPN(tokens) {
  const output = [];
  const operators = [];
  
  for (const token of tokens) {
    if (token.type === 'NUMBER') {
      output.push(token);
    } else if (token.type === 'FUNCTION') {
      operators.push(token);
    } else if (token.type === 'LPAREN') {
      operators.push(token);
    } else if (token.type === 'RPAREN') {
      let matched = false;
      while (operators.length > 0) {
        if (operators[operators.length - 1].type === 'LPAREN') {
          operators.pop(); // discard the left bracket
          matched = true;
          break;
        }
        output.push(operators.pop());
      }
      if (!matched) throw new Error('Parenthesis Mismatch');
      
      // If parenthesized expression was preceded by a function, pop function to RPN list
      if (operators.length > 0 && operators[operators.length - 1].type === 'FUNCTION') {
        output.push(operators.pop());
      }
    } else if (token.type === 'OPERATOR' || token.type === 'UNARY_MINUS' || token.type === 'POSTFIX') {
      const o1 = token;
      while (operators.length > 0) {
        const o2 = operators[operators.length - 1];
        if (o2.type !== 'OPERATOR' && o2.type !== 'UNARY_MINUS' && o2.type !== 'POSTFIX') {
          break;
        }
        
        const o1Prec = o1.precedence;
        const o2Prec = o2.precedence;
        
        if ((o1.associativity === 'LEFT' && o1Prec <= o2Prec) ||
            (o1.associativity === 'RIGHT' && o1Prec < o2Prec)) {
          output.push(operators.pop());
        } else {
          break;
        }
      }
      operators.push(o1);
    }
  }
  
  while (operators.length > 0) {
    const op = operators.pop();
    if (op.type === 'LPAREN' || op.type === 'RPAREN') {
      throw new Error('Parenthesis Mismatch');
    }
    output.push(op);
  }
  
  return output;
}

/**
 * Evaluate Reverse Polish Notation queue
 */
function evaluateRPN(rpn) {
  const stack = [];
  
  for (const token of rpn) {
    if (token.type === 'NUMBER') {
      stack.push(token.value);
    } else if (token.type === 'UNARY_MINUS') {
      if (stack.length < 1) throw new Error('Syntax Error');
      const val = stack.pop();
      stack.push(-val);
    } else if (token.type === 'POSTFIX') {
      if (stack.length < 1) throw new Error('Syntax Error');
      const val = stack.pop();
      if (token.value === '%') {
        stack.push(val / 100);
      } else if (token.value === '!') {
        stack.push(factorial(val));
      }
    } else if (token.type === 'OPERATOR') {
      if (stack.length < 2) throw new Error('Syntax Error');
      const b = stack.pop();
      const a = stack.pop();
      
      switch (token.value) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/': 
          if (b === 0) throw new Error('Cannot divide by zero');
          stack.push(a / b); 
          break;
        case '^': stack.push(Math.pow(a, b)); break;
        default: throw new Error(`Unknown Operator: ${token.value}`);
      }
    } else if (token.type === 'FUNCTION') {
      if (stack.length < 1) throw new Error('Syntax Error');
      const val = stack.pop();
      
      switch (token.value) {
        case 'sin':
          stack.push(Math.sin(state.angleMode === 'deg' ? val * Math.PI / 180 : val));
          break;
        case 'cos':
          stack.push(Math.cos(state.angleMode === 'deg' ? val * Math.PI / 180 : val));
          break;
        case 'tan':
          stack.push(Math.tan(state.angleMode === 'deg' ? val * Math.PI / 180 : val));
          break;
        case 'asin':
          const asinVal = Math.asin(val);
          stack.push(state.angleMode === 'deg' ? asinVal * 180 / Math.PI : asinVal);
          break;
        case 'acos':
          const acosVal = Math.acos(val);
          stack.push(state.angleMode === 'deg' ? acosVal * 180 / Math.PI : acosVal);
          break;
        case 'atan':
          const atanVal = Math.atan(val);
          stack.push(state.angleMode === 'deg' ? atanVal * 180 / Math.PI : atanVal);
          break;
        case 'ln':
          if (val <= 0) throw new Error('Invalid Log Input');
          stack.push(Math.log(val));
          break;
        case 'log':
          if (val <= 0) throw new Error('Invalid Log Input');
          stack.push(Math.log10(val));
          break;
        case 'sqrt':
          if (val < 0) throw new Error('Invalid Root Input');
          stack.push(Math.sqrt(val));
          break;
        case 'cbrt':
          stack.push(Math.cbrt(val));
          break;
        case 'fact':
          stack.push(factorial(val));
          break;
        case 'exp':
          stack.push(Math.exp(val));
          break;
        default:
          throw new Error(`Unknown Function: ${token.value}`);
      }
    }
  }
  
  if (stack.length !== 1) throw new Error('Syntax Error');
  
  const finalResult = stack[0];
  if (isNaN(finalResult)) throw new Error('Math Error (NaN)');
  if (!isFinite(finalResult)) throw new Error('Overflow (Infinity)');
  
  return finalResult;
}

/**
 * Main safe calculation wrapper
 */
function safeEvaluate(expressionStr) {
  try {
    if (!expressionStr.trim()) return '';
    const rawTokens = tokenize(expressionStr);
    const preprocessed = insertImplicitMultiplications(rawTokens);
    const rpn = parseInfixToRPN(preprocessed);
    const computedVal = evaluateRPN(rpn);
    
    // Round floats safely to prevent JS floating point precision issues (e.g. 0.1+0.2 = 0.30000000004)
    return parseFloat(computedVal.toFixed(12)).toString();
  } catch (err) {
    throw err;
  }
}

/* =========================================================================
   UI DISPLAY & CONTROL INTERACTION FUNCTIONS
   ========================================================================= */

/**
 * Format math expression strings for human display
 */
function formatDisplayExpression(expr) {
  if (!expr) return '';
  return expr
    .replace(/\*/g, ' × ')
    .replace(/\//g, ' ÷ ')
    .replace(/-/g, ' − ')
    .replace(/\+/g, ' + ')
    .replace(/\^/g, ' ^ ')
    .replace(/PI/g, 'π')
    .replace(/sin/g, 'sin')
    .replace(/cos/g, 'cos')
    .replace(/tan/g, 'tan')
    .replace(/asin/g, 'sin⁻¹')
    .replace(/acos/g, 'cos⁻¹')
    .replace(/atan/g, 'tan⁻¹')
    .replace(/ln/g, 'ln')
    .replace(/log/g, 'log')
    .replace(/sqrt/g, '√')
    .replace(/cbrt/g, '∛')
    .replace(/fact/g, '!')
    .replace(/exp/g, 'exp');
}

/**
 * Dynamic scale text size down for extremely long calculator results
 */
function adjustResultFontSize(valStr) {
  elResult.classList.remove('has-error');
  const len = valStr.length;
  if (len > 16) {
    elResult.style.fontSize = '1.35rem';
  } else if (len > 12) {
    elResult.style.fontSize = '1.75rem';
  } else if (len > 9) {
    elResult.style.fontSize = '2.15rem';
  } else {
    elResult.style.fontSize = '2.5rem';
  }
}

/**
 * Render the screen state changes
 */
function updateScreen() {
  elExpression.textContent = formatDisplayExpression(state.expression);
  elResult.textContent = state.result;
  
  adjustResultFontSize(state.result);
  
  // Keep expression display scrolled to the far right on overflow
  const wrapper = elExpression.parentElement;
  if (wrapper) {
    wrapper.scrollLeft = wrapper.scrollWidth;
  }
  
  // Angle toggle status label
  if (state.isSciMode) {
    elAngleIndicator.classList.remove('hidden');
    elAngleIndicator.textContent = state.angleMode.toUpperCase();
  } else {
    elAngleIndicator.classList.add('hidden');
  }
  
  // Memory indicator tag
  if (state.memory !== 0) {
    elMemoryIndicator.classList.remove('hidden');
  } else {
    elMemoryIndicator.classList.add('hidden');
  }
}

/**
 * Appends numbers or math units to the calculation builder
 */
function inputDigit(digit) {
  if (state.isEvaluated) {
    state.expression = '';
    state.isEvaluated = false;
  }
  
  // Prevent double decimals in the active number block
  if (digit === '.') {
    // Regex matches the last number block in the expression
    const lastNumMatch = state.expression.match(/[\d.]+(?!.*[\d.])/);
    if (lastNumMatch && lastNumMatch[0].includes('.')) {
      announceToSR('Decimal point already exists');
      return; // already has decimal, ignore
    }
  }
  
  state.expression += digit;
  updateScreen();
}

/**
 * Appends operators to the expression string
 */
function inputOperator(operator) {
  if (state.isEvaluated) {
    // Continue calculating using previous evaluated result
    state.expression = state.result;
    state.isEvaluated = false;
  }
  
  // If expression is empty, deny positive binary operators
  if (!state.expression && (operator === '*' || operator === '/' || operator === '^' || operator === '%')) {
    return;
  }
  
  // Replace active operator if clicked sequentially
  const lastChar = state.expression.slice(-1);
  const operators = ['+', '-', '*', '/', '^', '%'];
  
  if (operators.includes(lastChar)) {
    // Allow typing negative sign after multiplication, division, or exponentiation operators
    if (operator === '-' && ['*', '/', '^'].includes(lastChar)) {
      state.expression += operator;
    } else {
      state.expression = state.expression.slice(0, -1) + operator;
    }
  } else {
    state.expression += operator;
  }
  updateScreen();
}

/**
 * Clear All states
 */
function handleClear() {
  state.expression = '';
  state.result = '0';
  state.isEvaluated = false;
  updateScreen();
  announceToSR('Calculator Cleared');
}

/**
 * Backspace single characters
 */
function handleBackspace() {
  if (state.isEvaluated) {
    state.expression = '';
    state.isEvaluated = false;
    state.result = '0';
    updateScreen();
    return;
  }
  
  // Handle deleting multi-character scientific functions (e.g. 'sin(', 'sqrt(')
  const funcs = ['asin(', 'acos(', 'atan(', 'sin(', 'cos(', 'tan(', 'ln(', 'log(', 'sqrt(', 'cbrt(', 'fact(', 'exp('];
  let deletedFunc = false;
  
  for (const func of funcs) {
    if (state.expression.endsWith(func)) {
      state.expression = state.expression.slice(0, -func.length);
      deletedFunc = true;
      break;
    }
  }
  
  if (!deletedFunc && state.expression.length > 0) {
    state.expression = state.expression.slice(0, -1);
  }
  
  if (!state.expression) {
    state.result = '0';
  }
  
  updateScreen();
}

/**
 * Handle math evaluation
 */
function handleEvaluate() {
  if (!state.expression) return;
  
  try {
    const computation = safeEvaluate(state.expression);
    
    // Save to history list
    addHistoryItem(state.expression, computation);
    
    state.result = computation;
    state.isEvaluated = true;
    announceToSR(`Calculation evaluated: equals ${computation}`);
  } catch (err) {
    // Highlight screen errors in smaller red font
    elResult.classList.add('has-error');
    elResult.style.fontSize = '1.4rem';
    state.result = err.message || 'Error';
    announceToSR(`Calculation failed: ${state.result}`);
  }
  updateScreen();
}

/**
 * Handle Pos/Neg toggle button (±)
 * Toggles the sign of the last typed digit/variable cluster in the expression
 */
function handleNegate() {
  if (state.isEvaluated) {
    state.expression = state.result;
    state.isEvaluated = false;
  }
  
  // RegEx looks for numbers (including decimals/constants/parentheses) at the end of the line
  const regex = /(\d+(\.\d+)?([eE][+-]?\d+)?|PI|e|\([^)]*\))$/;
  const match = state.expression.match(regex);
  
  if (match) {
    const matchStr = match[0];
    const matchIdx = match.index;
    const prefix = state.expression.slice(0, matchIdx);
    
    // Check if the number was already negated (preceded by a unary minus symbol or bracket sequence)
    if (prefix.endsWith('(-')) {
      state.expression = prefix.slice(0, -2) + matchStr;
    } else if (prefix.endsWith('-') && (prefix.length === 1 || ['+', '*', '/', '('].includes(prefix.slice(-2, -1)))) {
      // It is a simple negative sign prefix
      state.expression = prefix.slice(0, -1) + matchStr;
    } else {
      // Negate the number grouping by wrapping in brackets
      state.expression = `${prefix}(-${matchStr})`;
    }
  } else {
    // If empty expression or ends with operator, just start negative
    state.expression += '-';
  }
  updateScreen();
}

/* =========================================================================
   MEMORY MANAGEMENT FUNCTIONS
   ========================================================================= */

function handleMemory(action) {
  let activeNum = parseFloat(state.result);
  
  // If result is invalid, ignore memory adjustments
  if (isNaN(activeNum)) return;
  
  switch (action) {
    case 'mc':
      state.memory = 0;
      announceToSR('Memory Cleared');
      break;
    case 'mr':
      // Append memory value to active expression builder
      inputDigit(state.memory.toString());
      announceToSR(`Memory Recalled: ${state.memory}`);
      break;
    case 'm-plus':
      state.memory += activeNum;
      state.isEvaluated = true; // resets display next type
      announceToSR(`Added ${activeNum} to Memory. New Memory: ${state.memory}`);
      break;
    case 'm-minus':
      state.memory -= activeNum;
      state.isEvaluated = true;
      announceToSR(`Subtracted ${activeNum} from Memory. New Memory: ${state.memory}`);
      break;
  }
  updateScreen();
  saveStateToStorage();
}

/* =========================================================================
   HISTORY MANAGEMENT FUNCTIONS
   ========================================================================= */

/**
 * Injects history rows into UI Sidebar
 */
function renderHistory() {
  listHistory.innerHTML = '';
  
  if (state.history.length === 0) {
    listHistory.innerHTML = '<div class="empty-history-msg">No history yet</div>';
    return;
  }
  
  state.history.forEach((item, index) => {
    const historyRow = document.createElement('button');
    historyRow.className = 'history-item';
    historyRow.setAttribute('tabindex', '0');
    historyRow.setAttribute('aria-label', `Restore past calculation: ${item.expression} equals ${item.result}`);
    
    historyRow.innerHTML = `
      <span class="history-item-exp">${formatDisplayExpression(item.expression)}</span>
      <span class="history-item-val">${item.result}</span>
    `;
    
    // Click to restore to main calc inputs
    historyRow.addEventListener('click', () => {
      playClickSound();
      state.expression = item.expression;
      state.result = item.result;
      state.isEvaluated = true;
      updateScreen();
      announceToSR(`Restored history item: ${item.expression}`);
    });
    
    listHistory.appendChild(historyRow);
  });
}

/**
 * Add item to history stack (max 50 logs for memory performance)
 */
function addHistoryItem(expr, res) {
  // Prevent adding identical sequential calculations to history
  if (state.history.length > 0 && state.history[0].expression === expr) {
    return;
  }
  
  state.history.unshift({ expression: expr, result: res });
  
  if (state.history.length > 50) {
    state.history.pop();
  }
  
  renderHistory();
  saveStateToStorage();
}

function clearHistory() {
  state.history = [];
  renderHistory();
  saveStateToStorage();
  announceToSR('Calculation History Cleared');
}

/* =========================================================================
   THEME, SCIENTIFIC & SOUND PREFERENCES
   ========================================================================= */

function toggleTheme() {
  state.isDarkTheme = !state.isDarkTheme;
  
  if (state.isDarkTheme) {
    document.body.classList.remove(THEME_CLASS);
    iconMoon.classList.remove('hidden');
    iconSun.classList.add('hidden');
    announceToSR('Dark theme enabled');
  } else {
    document.body.classList.add(THEME_CLASS);
    iconMoon.classList.add('hidden');
    iconSun.classList.remove('hidden');
    announceToSR('Light theme enabled');
  }
  
  saveStateToStorage();
}

function toggleScientificMode() {
  state.isSciMode = !state.isSciMode;
  const sciPad = document.getElementById('scientific-pad');
  const calcCard = document.querySelector('.calculator-card');
  
  if (state.isSciMode) {
    sciPad.classList.remove('hidden');
    calcCard.classList.add(SCI_ACTIVE_CLASS);
    btnToggleSci.classList.add('active');
    elModeIndicator.textContent = 'SCIENTIFIC';
    announceToSR('Scientific mode active');
  } else {
    sciPad.classList.add('hidden');
    calcCard.classList.remove(SCI_ACTIVE_CLASS);
    btnToggleSci.classList.remove('active');
    elModeIndicator.textContent = 'STANDARD';
    announceToSR('Standard mode active');
  }
  
  updateScreen();
  saveStateToStorage();
}

function toggleSound() {
  state.isSoundOn = !state.isSoundOn;
  
  if (state.isSoundOn) {
    iconSoundOn.classList.remove('hidden');
    iconSoundOff.classList.add('hidden');
    btnToggleSound.classList.add('active');
    announceToSR('Key audio clicks enabled');
  } else {
    iconSoundOn.classList.add('hidden');
    iconSoundOff.classList.remove('hidden');
    btnToggleSound.classList.remove('active');
    announceToSR('Key audio clicks disabled');
  }
  
  saveStateToStorage();
}

function toggleHistoryPanel() {
  panelHistory.classList.toggle('hidden');
  const isOpen = !panelHistory.classList.contains('hidden');
  btnToggleHistory.classList.toggle('active', isOpen);
  
  if (isOpen) {
    renderHistory();
    announceToSR('History drawer opened');
    // Shift keyboard focus to panel header for accessibility
    setTimeout(() => btnCloseHistory.focus(), 150);
  } else {
    announceToSR('History drawer closed');
  }
}

/**
 * Copies Result display values to user OS clipboard
 */
function copyToClipboard() {
  const textToCopy = state.result;
  if (!textToCopy || textToCopy === 'Error' || textToCopy.includes('Undefined')) return;
  
  navigator.clipboard.writeText(textToCopy).then(() => {
    // Show quick tooltip feedback
    copyToast.classList.remove('hidden');
    announceToSR(`Result copied to clipboard: ${textToCopy}`);
    
    setTimeout(() => {
      copyToast.classList.add('hidden');
    }, 1800);
  }).catch(err => {
    console.error('Failed to copy text: ', err);
  });
}

/* =========================================================================
   LOCAL STORAGE PERSISTENCE
   ========================================================================= */

function saveStateToStorage() {
  const appSettings = {
    isDarkTheme: state.isDarkTheme,
    isSciMode: state.isSciMode,
    isSoundOn: state.isSoundOn,
    angleMode: state.angleMode,
    memory: state.memory,
    history: state.history
  };
  localStorage.setItem('nebula_calc_settings', JSON.stringify(appSettings));
}

function loadStateFromStorage() {
  const rawData = localStorage.getItem('nebula_calc_settings');
  if (!rawData) return;
  
  try {
    const data = JSON.parse(rawData);
    
    // Apply preferences
    state.isSoundOn = data.isSoundOn !== undefined ? data.isSoundOn : true;
    if (!state.isSoundOn) {
      iconSoundOn.classList.add('hidden');
      iconSoundOff.classList.remove('hidden');
      btnToggleSound.classList.remove('active');
    }
    
    state.angleMode = data.angleMode || 'deg';
    state.memory = data.memory || 0;
    state.history = data.history || [];
    
    state.isDarkTheme = data.isDarkTheme !== undefined ? data.isDarkTheme : true;
    if (!state.isDarkTheme) {
      document.body.classList.add(THEME_CLASS);
      iconMoon.classList.add('hidden');
      iconSun.classList.remove('hidden');
    }
    
    state.isSciMode = data.isSciMode !== undefined ? data.isSciMode : false;
    if (state.isSciMode) {
      document.getElementById('scientific-pad').classList.remove('hidden');
      document.querySelector('.calculator-card').classList.add(SCI_ACTIVE_CLASS);
      btnToggleSci.classList.add('active');
      elModeIndicator.textContent = 'SCIENTIFIC';
    }
    
    renderHistory();
    updateScreen();
  } catch (err) {
    console.error('Error loading saved preferences:', err);
  }
}

/* =========================================================================
   KEYBOARD EVENT LISTENER INTEGRATION
   ========================================================================= */

function bindKeyboardInput() {
  document.addEventListener('keydown', (event) => {
    // Ignore keydown combinations using shortcuts like Ctrl+S, Cmd+R, etc.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    
    const key = event.key;
    
    // Number keys
    if (key >= '0' && key <= '9') {
      playClickSound();
      inputDigit(key);
      event.preventDefault();
    }
    // Decimal
    else if (key === '.') {
      playClickSound();
      inputDigit('.');
      event.preventDefault();
    }
    // Basic operations
    else if (key === '+') {
      playClickSound();
      inputOperator('+');
      event.preventDefault();
    }
    else if (key === '-') {
      playClickSound();
      inputOperator('-');
      event.preventDefault();
    }
    else if (key === '*') {
      playClickSound();
      inputOperator('*');
      event.preventDefault();
    }
    else if (key === '/') {
      playClickSound();
      inputOperator('/');
      event.preventDefault();
    }
    else if (key === '%') {
      playClickSound();
      inputOperator('%');
      event.preventDefault();
    }
    // Enter / Equals
    else if (key === 'Enter' || key === '=') {
      playClickSound();
      handleEvaluate();
      event.preventDefault();
    }
    // Backspace / Delete last char
    else if (key === 'Backspace') {
      playClickSound();
      handleBackspace();
      event.preventDefault();
    }
    // Escape / Clear All
    else if (key === 'Escape') {
      playClickSound();
      handleClear();
      event.preventDefault();
    }
    // Parentheses
    else if (key === '(') {
      playClickSound();
      inputDigit('(');
      event.preventDefault();
    }
    else if (key === ')') {
      playClickSound();
      inputDigit(')');
      event.preventDefault();
    }
    
    // Keyboard Hotkey shortcuts for controls
    const keyLower = key.toLowerCase();
    if (keyLower === 's') {
      // Toggle sound
      playClickSound();
      toggleSound();
      event.preventDefault();
    } else if (keyLower === 'm') {
      // Toggle scientific mode
      playClickSound();
      toggleScientificMode();
      event.preventDefault();
    } else if (keyLower === 'h') {
      // Toggle history
      playClickSound();
      toggleHistoryPanel();
      event.preventDefault();
    } else if (keyLower === 't') {
      // Toggle theme
      playClickSound();
      toggleTheme();
      event.preventDefault();
    }
  });
}

/* =========================================================================
   KEYPAD CLICK BINDINGS & INIT
   ========================================================================= */

function bindClickEvents() {
  const keypad = document.querySelector('.workspace-grid-container');
  
  keypad.addEventListener('click', (event) => {
    // Find closest key button clicked
    const keyBtn = event.target.closest('.key');
    if (!keyBtn) return;
    
    playClickSound();
    
    // Check key classifications
    if (keyBtn.dataset.val !== undefined) {
      inputDigit(keyBtn.dataset.val);
      return;
    }
    
    const action = keyBtn.dataset.action;
    
    switch (action) {
      // Operations
      case 'add': inputOperator('+'); break;
      case 'sub': inputOperator('-'); break;
      case 'mul': inputOperator('*'); break;
      case 'div': inputOperator('/'); break;
      case 'percent': inputOperator('%'); break;
      case 'pow': inputOperator('^'); break;
      
      // Values & decimals
      case 'decimal': inputDigit('.'); break;
      case 'open-paren': inputDigit('('); break;
      case 'close-paren': inputDigit(')'); break;
      case 'negate': handleNegate(); break;
      
      // Actions
      case 'clear': handleClear(); break;
      case 'backspace': handleBackspace(); break;
      case 'evaluate': handleEvaluate(); break;
      
      // Scientific constants
      case 'pi': inputDigit('PI'); break;
      case 'e': inputDigit('e'); break;
      
      // Scientific functions
      case 'sin': inputDigit('sin('); break;
      case 'cos': inputDigit('cos('); break;
      case 'tan': inputDigit('tan('); break;
      case 'asin': inputDigit('asin('); break;
      case 'acos': inputDigit('acos('); break;
      case 'atan': inputDigit('atan('); break;
      case 'ln': inputDigit('ln('); break;
      case 'log': inputDigit('log('); break;
      case 'sqrt': inputDigit('sqrt('); break;
      case 'cbrt': inputDigit('cbrt('); break;
      case 'fact': inputDigit('fact('); break;
      case 'exp': inputDigit('exp('); break;
      
      // Mode triggers
      case 'toggle-angle':
        state.angleMode = state.angleMode === 'deg' ? 'rad' : 'deg';
        updateScreen();
        saveStateToStorage();
        announceToSR(`Trigonometric mode toggled to ${state.angleMode.toUpperCase()}`);
        break;
      
      // Memory functions
      case 'mc':
      case 'mr':
      case 'm-plus':
      case 'm-minus':
        handleMemory(action);
        break;
    }
  });
}

function bindControlHeaders() {
  btnToggleSci.addEventListener('click', () => {
    playClickSound();
    toggleScientificMode();
  });
  
  btnToggleSound.addEventListener('click', () => {
    playClickSound();
    toggleSound();
  });
  
  btnToggleTheme.addEventListener('click', () => {
    playClickSound();
    toggleTheme();
  });
  
  btnToggleHistory.addEventListener('click', () => {
    playClickSound();
    toggleHistoryPanel();
  });
  
  btnCloseHistory.addEventListener('click', () => {
    playClickSound();
    toggleHistoryPanel();
  });
  
  btnClearHistory.addEventListener('click', () => {
    playClickSound();
    clearHistory();
  });
  
  btnCopyResult.addEventListener('click', () => {
    playClickSound();
    copyToClipboard();
  });
}

// App Initialization
function init() {
  bindClickEvents();
  bindControlHeaders();
  bindKeyboardInput();
  
  // Load local preferences
  loadStateFromStorage();
  updateScreen();
}

document.addEventListener('DOMContentLoaded', init);
