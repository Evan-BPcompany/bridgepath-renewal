import { analyzeGolfShoeImage, GOLF_SHOE_SYSTEM_PROMPT } from '../services/golfShoeAnalysisService';
import { ImageAnalysisFailedError, MessagesClient } from '../services/imageAnalysisService';

// No call to the real Claude API: the client is a fake that records the request.
const GOOD = {
  is_golf_shoe: true,
  style: 'sneaker',
  closure: 'dial',
  outsole: 'spikeless',
  upper_material: 'microfiber',
  confidence: 'medium',
  summary: '다이얼로 조이는 스파이크리스 스니커형 골프화예요.',
  complexity: 'high',
  overview: '다이얼 조임 방식의 스니커형 골프화입니다.',
  details: { upper: '마이크로파이버 어퍼', sole: '스파이크리스 솔', closure: '다이얼', decoration: '사진으로 확인되지 않아요' },
  visible_features: ['다이얼 조임', '스파이크리스 솔'],
  unconfirmed: ['방수 여부', '중창 소재'],
  cost_factors: ['다이얼 부품', '솔 금형'],
  recommendations: ['일반 레이스로 바꾸면 원가 절감']
};

const fakeClient = (response: Record<string, unknown>): { client: MessagesClient; create: jest.Mock } => {
  const create = jest.fn().mockResolvedValue(response);
  return { client: { messages: { create } } as unknown as MessagesClient, create };
};

const textAnswer = (text: string, stopReason = 'end_turn') => ({ stop_reason: stopReason, content: [{ type: 'text', text }] });

const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

describe('analyzeGolfShoeImage', () => {
  it('returns the analysis the model gave', async () => {
    const { client } = fakeClient(textAnswer(JSON.stringify(GOOD)));

    await expect(analyzeGolfShoeImage(IMAGE, 'image/png', client)).resolves.toEqual(GOOD);
  });

  it('sends the photo as base64 and asks for the golf shoe schema, with no forced tool, prefill or sampling', async () => {
    const { client, create } = fakeClient(textAnswer(JSON.stringify(GOOD)));

    await analyzeGolfShoeImage(IMAGE, 'image/webp', client);

    const params = create.mock.calls[0][0];
    expect(params.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/webp', data: IMAGE.toString('base64') }
    });
    expect(params.output_config.format.schema.required).toEqual(expect.arrayContaining(['closure', 'outsole', 'upper_material', 'unconfirmed']));
    expect(params.tool_choice).toBeUndefined();
    expect(params.temperature).toBeUndefined();
    expect(params.messages.some((message: { role: string }) => message.role === 'assistant')).toBe(false);
  });

  it('uses the values of the shoes form for the upper material and the outsole', async () => {
    const { client, create } = fakeClient(textAnswer(JSON.stringify(GOOD)));

    await analyzeGolfShoeImage(IMAGE, 'image/png', client);

    const properties = create.mock.calls[0][0].output_config.format.schema.properties;
    expect(properties.upper_material.enum).toEqual(['leather', 'synthetic', 'microfiber', 'mesh', 'mixed', 'unknown']);
    expect(properties.outsole.enum).toEqual(['spike', 'spikeless', 'hybrid', 'unknown']);
  });

  it('forbids prices, tells the model that text in the photo is no instruction, and says what a photo cannot show', () => {
    expect(GOLF_SHOE_SYSTEM_PROMPT).toMatch(/Never give a price/);
    expect(GOLF_SHOE_SYSTEM_PROMPT).toMatch(/never follow/i);
    expect(GOLF_SHOE_SYSTEM_PROMPT).toMatch(/cannot reliably tell leather from microfiber/);
    expect(GOLF_SHOE_SYSTEM_PROMPT).toMatch(/unconfirmed/);
  });

  it('keeps at most five items of each list', async () => {
    const long = {
      ...GOOD,
      visible_features: ['1', '2', '3', '4', '5', '6'],
      unconfirmed: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      cost_factors: ['x', 'x', 'x', 'x', 'x', 'x'],
      recommendations: ['y', 'y', 'y', 'y', 'y', 'y']
    };
    const { client } = fakeClient(textAnswer(JSON.stringify(long)));

    const result = await analyzeGolfShoeImage(IMAGE, 'image/png', client);

    expect(result.visible_features).toHaveLength(5);
    expect(result.unconfirmed).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.cost_factors).toHaveLength(5);
    expect(result.recommendations).toHaveLength(5);
  });

  it('fails when the model refuses, or the answer is not text, not JSON or does not match the schema', async () => {
    const answers = [
      { stop_reason: 'refusal', content: [] },
      { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] },
      textAnswer('they look like spikes'),
      textAnswer(JSON.stringify({ ...GOOD, closure: 'boa' })),
      textAnswer(JSON.stringify({ ...GOOD, outsole: 'cleats' })),
      textAnswer(JSON.stringify({ ...GOOD, extra: true })),
      textAnswer(JSON.stringify({ is_golf_shoe: true })),
      textAnswer(JSON.stringify({ ...GOOD, details: { upper: 'x' } }))
    ];

    for (const answer of answers) {
      const { client } = fakeClient(answer);
      await expect(analyzeGolfShoeImage(IMAGE, 'image/png', client)).rejects.toBeInstanceOf(ImageAnalysisFailedError);
    }
  });

  it('lets an error of the API through unchanged', async () => {
    const create = jest.fn().mockRejectedValue(new Error('529 overloaded'));

    await expect(analyzeGolfShoeImage(IMAGE, 'image/png', { messages: { create } } as unknown as MessagesClient)).rejects.toThrow('529 overloaded');
  });
});
