addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request).catch((err) => {
        return new Response(JSON.stringify({error: 500, message: err.message}), {
            status: 500,
            headers: new Headers({'content-type': 'application/json'})
        });
    }));
});

const HTML_TEXT = `
<html>
<head>
    <meta charset="utf-8">
</head>
<body>
<input type="url" placeholder="url" id="url" style="height: 20px;width: 80%; display: block;">
<input type="submit" id="submit" value="submit"/>
<div><a id="a" href=""></a></div>
<p>注:该工具只针对直链有效</p>
<hr>
<h3>代理下载</h3>
<p>GET /down/http://example.com</p>
<p>直接将网址放到url后面即可</p>
<hr>
<h3>身份匿名授权(dev)</h3>
<p>适用场景:a访问b网址下载文件需要提供token,a想要c能够下载b网址的文件,但又不想让c知道token内容.
    a可以通过提交token给cf,cf生成临时链接供c使用,c无法得知token的内容.</p>
<p>获取临时链接</p>
<p>POST /request/ {method = 'GET', url, body = '', headers = {}, token, max_age = 12*3600}</p>
<p>使用key</p>
<div>GET /request/ODAzMzUyMzY1MjY1MDQw</div>

<script>
    document.getElementById('submit').onclick = function () {
        const url = document.getElementById('url').value;
        console.log('url: ' + url);
        const a = document.getElementById('a');
        if (!url || !url.startsWith('http')) {
            a.textContent = "链接不合法: " + url;
            a.href = 'javascript:void';
        } else {
            a.href = a.textContent = (new URL(window.location.href)).origin + '/down/' + url;
        }
    };
</script>
</body>
</html>
`;

const MAX_DATA_LEN = 1024;
const REQ_TOKEN = '';
const PATH_REQUEST = '/request/';
const PATH_DOWN = '/down/';

const REQUEST_HEADERS_EXPOSED = [
    'accept', 'accept-encoding', 'accept-language', 'cache-control', 'range', 'user-agent'
];

const RESPONSE_HEADERS_EXPOSED = [
    "Accept-Ranges", "Cache-Control", "Connection", "Content-Disposition", "Content-Encoding", "Content-Length", "Content-Range", "Content-Type", "Date"
];

/**
 * Respond to the request
 * @param {Request} request
 */
async function handleRequest(request) {

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: new Headers({
                'access-control-allow-origin': request.headers.has('origin') || '*',
                'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
                'access-control-allow-headers': request.headers.has('access-control-request-headers') || '*',
                'access-control-max-age': '86400'
            }),
        });
    }
    const req_url = new URL(request.url);
    if (req_url.pathname.startsWith(PATH_REQUEST)) {
        return forRequest(request, req_url.pathname.slice(PATH_REQUEST.length));
    }

    if (req_url.pathname.startsWith(PATH_DOWN)) {
        const url = req_url.pathname.slice(PATH_DOWN.length).replace(/^(https?):\/+/, '$1://') + req_url.search;
        return forDown(request, url);
    }

    if (request.headers.get('referer')) {
        const url = new URL(request.headers.get('referer'));
        if (url.pathname.startsWith(PATH_DOWN)) {
            const origin = new URL(url.pathname.slice(PATH_DOWN.length).replace(/^(https?):\/+/, '$1://')).origin;
            return new Response(null, {
                status: 301,
                headers: new Headers({'location': PATH_DOWN + origin + req_url.pathname + req_url.search})
            });
        }
    }

    return new Response(HTML_TEXT, {headers: new Headers({'content-type': 'text/html'})});
}

async function forRequest(request, id) {
    if (request.method === "POST") {
        const {method = 'GET', url, body = '', headers = {}, token, max_age = 12 * 3600} = await request.json();
        const d = JSON.stringify({method, url, body, headers});
        if (d.length > MAX_DATA_LEN) {
            throw new Error('your request data is too much long');
        }
        if (REQ_TOKEN && token !== REQ_TOKEN) {
            throw new Error('unauthorized key');
        }
        if (!/^https?:\/\/.+/.test(url)) {
            throw new Error('url is invalid:' + url);
        }
        //小概率事件 不再检测碰撞
        const key = randKey();
        await saveKV(key, d, max_age);
        return new Response(JSON.stringify({key}));
    }

    if (request.method === 'GET') {
        const match = /^([^/]+)$/.exec(id);
        if (!match) {
            throw new Error('invalid url, eg: https://<baseURL>/ODAzMzUyMzY1MjY1MDQw');
        }
        const s = await getKV(match[1]);
        if (!s) {
            throw new Error('no such key');
        }
        const d = JSON.parse(s);
        if (d.method === 'GET') {
            delete d.body;
        }
        return endWithFetch(d.url, d, request);
    }
}

async function forDown(request, url) {
    if (request.method === 'GET') {
        return endWithFetch(url, {headers: {}}, request);
    }
}


async function endWithFetch(url, init, request) {
    const headers = {};
    REQUEST_HEADERS_EXPOSED.forEach((k) => {
        if (request.headers.get(k)) {
            headers[k] = request.headers.get(k);
        }
    });
    init.headers = new Headers(Object.assign(headers, init.headers));
    const response = await fetch(url, init);
    const h = {'access-control-allow-origin': '*'};
    RESPONSE_HEADERS_EXPOSED.forEach((k) => {
        if (response.headers.get(k)) {
            h[k] = response.headers.get(k);
        }
    });
    return new Response(response.body, {
        status: response.status,
        headers: new Headers(h),
    });
}


function randKey() {
    return btoa(('' + Math.random()).slice(2)).slice(0, 20);
}

async function saveKV(k, v, t) {
    return LINKS.put(k, v, {expirationTtl: t});
}

async function getKV(k) {
    return await LINKS.get(k);
}
