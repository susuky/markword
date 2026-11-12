import { getHtmlBlockId } from './htmlBlocks'

export type HtmlRenderSnapshot = { html: string; dynamicIds: string[] }

const CHANNEL = 'markword-html-runtime'
const SOURCE_ATTRIBUTE = 'data-markword-source-id'
const RUNTIME_ATTRIBUTE = 'data-markword-runtime'
const SCRIPT_ATTRIBUTE = 'data-markword-runtime-script'
const SCRIPT_TYPE_ATTRIBUTE = 'data-markword-runtime-type'
const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

function isExecutableScript(script: HTMLScriptElement) {
  const type = script.type.trim().toLowerCase()
  return !type || type === 'module' || /^(?:application|text)\/(?:java|ecma)script(?:\s*;|$)/.test(type)
}

export function hasHtmlScripts(source: string) {
  const document = new DOMParser().parseFromString(source, 'text/html')
  return Array.from(document.scripts).some(isExecutableScript)
}

// Keep a serialized document inside an inline script without introducing a closing tag.
function scriptString(value: string) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function runtimeDocument(source: string) {
  const document = new DOMParser().parseFromString(source, 'text/html')
  ;[document.body, ...document.body.querySelectorAll('*')].forEach((element) => element.setAttribute(SOURCE_ATTRIBUTE, getHtmlBlockId(element)))
  document.querySelectorAll('base, iframe, object, embed, meta[http-equiv]').forEach((element) => element.remove())
  for (const script of Array.from(document.scripts)) {
    if (!isExecutableScript(script)) continue
    script.setAttribute(SCRIPT_ATTRIBUTE, script.hasAttribute('src') ? 'external' : 'inline')
    script.setAttribute(SCRIPT_TYPE_ATTRIBUTE, script.getAttribute('type') ?? '')
    script.removeAttribute('src')
    script.type = 'application/x-markword-script'
  }
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = POLICY
  policy.setAttribute(RUNTIME_ATTRIBUTE, '')
  document.head.prepend(policy)
  const bridge = document.createElement('script')
  bridge.setAttribute(RUNTIME_ATTRIBUTE, '')
  bridge.textContent = `(() => {
    const channel = ${scriptString(CHANNEL)};
    const sourceAttribute = ${scriptString(SOURCE_ATTRIBUTE)};
    const runtimeAttribute = ${scriptString(RUNTIME_ATTRIBUTE)};
    const scriptAttribute = ${scriptString(SCRIPT_ATTRIBUTE)};
    const scriptTypeAttribute = ${scriptString(SCRIPT_TYPE_ATTRIBUTE)};
    const send = parent.postMessage.bind(parent);
    const originals = new Map([document.body, ...document.body.querySelectorAll('[' + sourceAttribute + ']')].map(element => [element.getAttribute(sourceAttribute), element]));
    window.addEventListener('message', event => {
      if (event.source === parent && event.data?.channel === channel && event.data.kind === 'ping') send({ channel, kind: 'pong', sequence: event.data.sequence }, '*');
    });
    const dynamicIds = new Set();
    let timer;
    let loaded = false;
    const isRuntimeNode = node => node.nodeType === 1 && (node.tagName === 'SCRIPT' || node.hasAttribute(runtimeAttribute));
    const record = records => {
      for (const mutation of records) {
        if (mutation.type === 'attributes') continue;
        if (mutation.type === 'childList' && [...mutation.addedNodes, ...mutation.removedNodes].every(isRuntimeNode)) continue;
        const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (!element || element.closest('script, style, [' + runtimeAttribute + ']')) continue;
        let original = element;
        while (original && originals.get(original.getAttribute(sourceAttribute)) !== original) original = original.parentElement;
        if (original) dynamicIds.add(original.getAttribute(sourceAttribute));
      }
    };
    const capture = () => {
      record(observer.takeRecords());
      const copy = document.documentElement.cloneNode(true);
      const liveSources = document.querySelectorAll('[' + sourceAttribute + ']');
      copy.querySelectorAll('[' + sourceAttribute + ']').forEach((element, index) => {
        if (originals.get(element.getAttribute(sourceAttribute)) !== liveSources[index]) element.removeAttribute(sourceAttribute);
      });
      const liveControls = document.querySelectorAll('input, textarea, select');
      copy.querySelectorAll('input, textarea, select').forEach((element, index) => {
        const live = liveControls[index];
        if (element.tagName === 'TEXTAREA') element.textContent = live.value;
        else if (element.tagName === 'SELECT') [...element.options].forEach((option, index) => option.toggleAttribute('selected', live.options[index].selected));
        else { element.setAttribute('value', live.value); element.toggleAttribute('checked', live.checked); }
      });
      const canvases = document.querySelectorAll('canvas');
      copy.querySelectorAll('canvas').forEach((canvas, index) => {
        try {
          const image = document.createElement('img');
          for (const attribute of canvas.attributes) image.setAttribute(attribute.name, attribute.value);
          image.src = canvases[index].toDataURL();
          image.width = canvases[index].width;
          image.height = canvases[index].height;
          canvas.replaceWith(image);
        } catch { /* A canvas containing protected image pixels cannot be exported. */ }
      });
      copy.querySelectorAll('[' + runtimeAttribute + ']').forEach(element => element.remove());
      copy.querySelectorAll('[' + scriptAttribute + ']').forEach(element => {
        element.removeAttribute(scriptAttribute);
        element.removeAttribute(scriptTypeAttribute);
      });
      send({ channel, kind: 'snapshot', html: '<!doctype html>\\n' + copy.outerHTML, dynamicIds: [...dynamicIds] }, '*');
    };
    const schedule = () => { if (loaded) { clearTimeout(timer); timer = setTimeout(capture, 80); } };
    const observer = new MutationObserver(records => { record(records); schedule(); });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    document.addEventListener('click', schedule, true);
    document.addEventListener('submit', event => event.preventDefault(), true);
    document.addEventListener('click', event => {
      const anchor = event.target.closest && event.target.closest('a[href]');
      if (anchor && !anchor.getAttribute('href').startsWith('#')) event.preventDefault();
    }, true);
    window.addEventListener('error', event => {
      event.preventDefault();
      if (event.message) send({ channel, kind: 'error', message: event.message }, '*');
    });
    window.addEventListener('load', () => { loaded = true; schedule(); }, { once: true });
    for (const placeholder of [...document.querySelectorAll('script[' + scriptAttribute + ']')]) {
      if (placeholder.getAttribute(scriptAttribute) === 'external') continue;
      const script = document.createElement('script');
      for (const attribute of placeholder.attributes) if (attribute.name !== 'type' && attribute.name !== scriptAttribute && attribute.name !== scriptTypeAttribute) script.setAttribute(attribute.name, attribute.value);
      const type = placeholder.getAttribute(scriptTypeAttribute);
      if (type) script.type = type;
      script.textContent = placeholder.textContent;
      placeholder.replaceWith(script);
    }
  })();`
  document.body.append(bridge)
  return '<!doctype html>\n' + document.documentElement.outerHTML
}

export function createHtmlRuntimeDocument(source: string) {
  // The trusted parent policy also constrains navigations initiated by the opaque
  // child. Its own CSP cannot prevent a script from navigating its own frame.
  const wrapperPolicy = POLICY.replace("frame-src 'none'", 'frame-src about:')
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${wrapperPolicy}"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block;overflow:hidden}</style></head><body><script>(() => {
    const source = ${scriptString(runtimeDocument(source))};
    const channel = ${scriptString(CHANNEL)};
    const frame = document.createElement('iframe');
    frame.title = 'HTML runtime document';
    frame.sandbox = 'allow-scripts';
    frame.referrerPolicy = 'no-referrer';
    let sequence = 0;
    let checkTimer;
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow || !event.data || event.data.channel !== channel) return;
      if (event.data.kind === 'pong') { if (event.data.sequence === sequence) clearTimeout(checkTimer); return; }
      parent.postMessage(event.data, '*');
    });
    frame.addEventListener('load', () => {
      clearTimeout(checkTimer);
      sequence += 1;
      checkTimer = setTimeout(() => { frame.srcdoc = source; }, 150);
      frame.contentWindow.postMessage({ channel, kind: 'ping', sequence }, '*');
    });
    frame.srcdoc = source;
    document.body.append(frame);
  })();</script></body></html>`
}

export function subscribeHtmlRuntime(
  frame: HTMLIFrameElement,
  onSnapshot: (snapshot: HtmlRenderSnapshot) => void,
  onError: (message: string, fatal?: boolean) => void,
) {
  let received = false
  const timeout = window.setTimeout(() => { if (!received) onError('The HTML page did not finish rendering.', true) }, 15_000)
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || !event.data || event.data.channel !== CHANNEL) return
    const message = event.data
    if (message.kind === 'error' && typeof message.message === 'string') onError(message.message)
    if (message.kind !== 'snapshot' || typeof message.html !== 'string' || !Array.isArray(message.dynamicIds) || !message.dynamicIds.every((id: unknown) => typeof id === 'string')) return
    received = true
    window.clearTimeout(timeout)
    onSnapshot({ html: message.html, dynamicIds: message.dynamicIds })
  }
  window.addEventListener('message', receive)
  return () => {
    window.clearTimeout(timeout)
    window.removeEventListener('message', receive)
  }
}

export function renderHtmlDocument(source: string, signal?: AbortSignal): Promise<HtmlRenderSnapshot> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const frame = document.createElement('iframe')
    frame.title = 'HTML rendering'
    frame.setAttribute('aria-hidden', 'true')
    // Configure the detached frame so an initial about:blank navigation cannot race srcdoc.
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.referrerPolicy = 'no-referrer'
    frame.srcdoc = createHtmlRuntimeDocument(source)
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;pointer-events:none'
    const cleanup = () => { dispose(); frame.remove(); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    const dispose = subscribeHtmlRuntime(frame, snapshot => { cleanup(); resolve(snapshot) }, (message, fatal) => {
      if (fatal) { cleanup(); reject(new Error(message)) }
    })
    signal?.addEventListener('abort', abort, { once: true })
    document.body.append(frame)
  })
}
