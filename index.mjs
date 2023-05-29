import { createServer } from 'http'
import { readFile, writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, sep } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const jsonDataFilename = __dirname + sep + 'urls.json'

const args = parseCmdArgs()

// 可以让用户提供一个端口, 以及一个用于短链接的前缀

// 端口, 如果未提供, 那就选择一个数字较大的端口
const port = parseInt(args.port) || randomInt(10000, 65535)
if (!Number.isInteger(port) || port > 65535)
  throw new Error('port 参数错误')

// 前缀, 如果未提供端口, 就使用 http://127.0.0.1
const prefix = args.prefix || `http://127.0.0.1:${port}/`
if (!prefix || !prefix.startsWith('http://'))
  throw new Error('prefix 参数错误')

// 保存时间间隔, 如果未提供, 就使用 1000
const save = parseInt(args.save) || 60000
if (!Number.isInteger(save) || save < 1000)
  throw new Error('save 参数错误')

process.on('SIGINT',  quit) // Ctrl + C
process.on('SIGQUIT', quit) // Keyboard quit
process.on('SIGTERM', quit) // kill

let longMap   = new Map()
let shortMap  = new Map()
let counter   = 0
let changed   = false
let indexHtml = ''

;(async () => {
  await loadData()
  setTimeout(async () => {
    if (changed) {
      changed = false
      await saveData()
    }
  }, save)

  indexHtml = await readFile(__dirname + sep + 'index.html', 'utf8')

  const server = createServer(handleRequest)
  server.listen(port, '0.0.0.0')
  console.log(`Listen on ${port}`)
})()

/**
 * 退出应用
 *
 * @returns {Promise<void>}
 */
async function quit() {
  await saveData()
  console.log('goodbye')
  process.exit(0)
}

/**
 * 处理请求
 *
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
function handleRequest (request, response) {

  // GET　请求
  if (request.method === 'GET') {
    // 去掉开头的 /
    const url = request.url.substring(1)

    if (url === '')
      return sendHtml(response, indexHtml)

    const longUrl = toLong(url)
    console.log({ shortUrl: url, longUrl })
    response.writeHead(302, { 'Location': longUrl })
    response.end()
  }

  // POST 请求
  if (request.method === 'POST') {

    // 只处理 json
    if (request.headers['content-type'] !== 'application/json')
      request.connection.destroy()

    let body = ''
    request.on('data', data => {
      body += data
      // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ≈ 1MB
      // 阻止流量攻击
      if (body.length > 1e6)
        request.connection.destroy()

      request.on('end', () => {

        let post

        try {
          post = JSON.parse(body)
        } catch (e) {
          request.connection.destroy()
        }

        if (!post.longUrl)
          request.connection.destroy()
        else {
          const shortUrl = toShort(post.longUrl)
          console.log({ longUrl: post.longUrl, shortUrl })

          if (!shortUrl)
            return request.connection.destroy()

          sendJSON(response, { shortUrl: prefix + shortUrl })
        }
      })
    })
  }
}

/**
 * 发送 HTML
 *
 * @param response
 * @param content
 */
function sendHtml (response, content) {
  response.writeHead(200, { 'Content-Type': 'text/html' })
  response.end(content, 'utf-8')
}

/**
 * 发送 JSON
 *
 * @param response
 * @param data
 */
function sendJSON (response, data) {
  // 发送 HTTP 头部
  response.writeHead(200, { 'Content-Type': 'application/json' })

  // 发送响应数据
  response.end(JSON.stringify(data))
}

/**
 * 保存数据
 */
async function saveData () {
  const data = {
    longMap: [...longMap],
    shortMap: [...shortMap],
    counter,
  }
  const json = JSON.stringify(data)
  await writeFile(jsonDataFilename, json, 'utf8')
}

/**
 * 加载数据
 */
async function loadData () {
  let savedData = {}
  try {
    const j = await readFile(jsonDataFilename, 'utf8')
    if (j) {
      savedData = JSON.parse(j)
      longMap   = new Map(savedData.longMap)
      shortMap  = new Map(savedData.shortMap)
      counter   = savedData.counter
    }
  } catch (e) {
  }
}

/**
 * 获取计数器
 *
 * @returns {number}
 */
function getCounter () {
  counter++
  return counter
}

/**
 * 得到短链接
 *
 * @param {string} longUrl 长链接
 * @returns {string}
 */
function toShort (longUrl) {
  if (!checkUrl(longUrl))
    return ''

  // 如果已经存在对应的短链接, 那么直接返回
  let shortUrl = longMap.get(longUrl)
  if (shortUrl)
    return shortUrl

  const counter = getCounter()
  shortUrl = base26(counter)

  longMap.set(longUrl, shortUrl)
  shortMap.set(shortUrl, {
    longUrl,
    clicks: 0,
    createdAt: Date.now()
  })

  changed = true
  return shortUrl
}

/**
 * 得到长链接
 *
 * @param {string} shortUrl 短链接
 * @returns {string}
 */
function toLong (shortUrl) {
  const longObj = shortMap.get(shortUrl)
  if (longObj) {
    longObj.clicks++
    shortMap.set(shortUrl, longObj)
    changed = true
    return longObj.longUrl
  }

  return ''
}

/**
 * 检查链接
 *
 * @param url
 * @returns {boolean}
 */
function checkUrl (url) {
  url = url.trim()
  if (url.startsWith('https://'))
    return url.length > 8
  if (url.startsWith('http://'))
    return url.length > 7
  return false
}

/**
 * 将整数转换成 26 个小写字母形式
 *
 * @param {number} n
 * @returns {string}
 */
function base26 (n) {
  const s = n.toString(26)

  const a = '0123456789abcdefghijklmnop'
  const b = 'abcdefghijklmnopqrstuvwxyz'

  let r = ''
  for (let i = 0; i < s.length; i++)
    r += b[a.indexOf(s[i])]

  return r
}

/**
 * 解析命令行参数,
 * 这里假设命令行参数都是 --abc=xyz --one=1 的形式, 那么返回 { abc: 'xyz', one: '1' },
 * 注意, key 和 value 都是字符串
 *
 * @returns {{}}
 */
function parseCmdArgs () {
  // 第一个元素是 NodeJS 解释器路径
  // 第二个元素是正在执行的 js 文件路径
  // 从第三个元素开始才是用户提供的参数
  const keyValuePairs = process.argv.slice(2)
  const args = {}
  for (let pair of keyValuePairs) {
    if (!pair.startsWith('--'))
      continue

    const i = pair.indexOf('=')
    if (i < 3)
      continue

    // key: pair.slice(2, i)
    // value: pair.slice(i, i + 1)
    args[pair.slice(2, i)] = pair.slice(i + 1)
  }

  return args
}

/**
 * 获取随机整数
 *
 * @param {number} min 随机整数可能的最小值
 * @param {number} max 随机整数可能的最大值
 * @return {number}
 * @throws
 */
function randomInt (min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max))
    throw new TypeError()

  if (min > max)
    throw new RangeError()

  return Math.floor(Math.random() * (max - min + 1) + min)
}