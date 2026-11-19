import { describe, expect, it } from 'vitest'
import { createChatEventParser } from './sse-parser.ts'

describe('chat event parser', () => {
  it('reads each event of a stream in order', () => {
    const parse = createChatEventParser()

    const events = parse(
      'event:token\ndata:{"type":"token","text":"Hello"}\n\n' +
        'event:token\ndata:{"type":"token","text":" there"}\n\n' +
        'event:done\ndata:{"type":"done"}\n\n',
    )

    expect(events).toEqual([
      { type: 'token', text: 'Hello' },
      { type: 'token', text: ' there' },
      { type: 'done' },
    ])
  })

  it('joins a frame split across chunks, also between CR and LF', () => {
    const parse = createChatEventParser()

    expect(parse('event: tok')).toEqual([])
    expect(parse('en\r\ndata: {"type":"token",')).toEqual([])
    expect(parse('"text":"Hello"}\r')).toEqual([])
    expect(parse('\n\r\nevent:done\ndata:{"type":"done"}\n')).toEqual([
      { type: 'token', text: 'Hello' },
    ])
    expect(parse('\n')).toEqual([{ type: 'done' }])
  })

  it('joins multi-line data with a line feed', () => {
    const parse = createChatEventParser()

    const events = parse('event:token\ndata:{"type":"token",\ndata:"text":"a"}\n\n')

    expect(events).toEqual([{ type: 'token', text: 'a' }])
  })

  it('ignores unknown event names, comments and data that is not an event of its name', () => {
    const parse = createChatEventParser()

    const events = parse(
      ':keep-alive\n\n' +
        'event:thinking\ndata:{"type":"thinking"}\n\n' +
        'event:tool\ndata:{"type":"tool","tool":"searchTickets","arguments":{}}\n\n' +
        'data:{"type":"token","text":"no event name"}\n\n' +
        'event:token\ndata:{"type":"done"}\n\n' +
        'event:token\ndata:not json\n\n' +
        'event:error\ndata:{"type":"error","code":"timeout"}\n\n',
    )

    expect(events).toEqual([{ type: 'error', code: 'timeout' }])
  })
})
