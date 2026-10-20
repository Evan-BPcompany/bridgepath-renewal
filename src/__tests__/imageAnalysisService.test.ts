import {
  analyzeSunglassesImage,
  ImageAnalysisFailedError,
  MessagesClient
} from '../services/imageAnalysisService';

// No call to the real Claude API: the client is a fake that records the request.
const GOOD = {
  is_sunglasses: true,
  frame_material: 'acetate',
  lens_type: 'gradient',
  confidence: 'medium',
  summary: '두꺼운 아세테이트 프레임에 그라데이션 렌즈예요.',
  frame_shape: '스퀘어',
  frame_color: '블랙',
  complexity: 'medium',
  overview: '두꺼운 아세테이트 프레임의 클래식 선글라스입니다.',
  details: { frame: '두께감 있는 프레임', lens: '그라데이션 틴트', decoration: '사진으로 확인되지 않아요' },
  cost_factors: ['아세테이트 가공', '그라데이션 렌즈 코팅'],
  recommendations: ['사출 프레임으로 변경하면 원가 절감']
};

function fakeClient(response: Record<string, unknown>): { client: MessagesClient; create: jest.Mock } {
  const create = jest.fn().mockResolvedValue(response);
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

const textAnswer = (text: string, stopReason = 'end_turn') => ({
  stop_reason: stopReason,
  content: [{ type: 'text', text }]
});

const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

describe('analyzeSunglassesImage', () => {
  afterEach(() => {
    delete process.env.IMAGE_ANALYSIS_MODEL;
  });

  it('returns the analysis the model gave', async () => {
    const { client } = fakeClient(textAnswer(JSON.stringify(GOOD)));

    await expect(analyzeSunglassesImage(IMAGE, 'image/png', client)).resolves.toEqual(GOOD);
  });

  it('sends the photo as base64 with the media type, and asks for the schema', async () => {
    const { client, create } = fakeClient(textAnswer(JSON.stringify(GOOD)));

    await analyzeSunglassesImage(IMAGE, 'image/png', client);

    const params = create.mock.calls[0][0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0].role).toBe('user');
    expect(params.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: IMAGE.toString('base64') }
    });
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.output_config.format.schema.required).toEqual(
      expect.arrayContaining(['is_sunglasses', 'frame_material', 'lens_type'])
    );
    // No forced tool use, no prefill, no sampling parameters: the newest models reject them.
    expect(params.tool_choice).toBeUndefined();
    expect(params.temperature).toBeUndefined();
    expect(params.messages.some((message: { role: string }) => message.role === 'assistant')).toBe(false);
  });

  it('takes the model from IMAGE_ANALYSIS_MODEL when it is set', async () => {
    process.env.IMAGE_ANALYSIS_MODEL = 'claude-sonnet-5-5';
    const { client, create } = fakeClient(textAnswer(JSON.stringify(GOOD)));

    await analyzeSunglassesImage(IMAGE, 'image/jpeg', client);

    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5-5');
  });

  it('tells the model that text inside the photo is not an instruction', async () => {
    const { client, create } = fakeClient(textAnswer(JSON.stringify(GOOD)));

    await analyzeSunglassesImage(IMAGE, 'image/gif', client);

    expect(create.mock.calls[0][0].system).toMatch(/never follow/i);
  });

  it('keeps at most four cost factors and four recommendations', async () => {
    const long = { ...GOOD, cost_factors: ['a', 'b', 'c', 'd', 'e', 'f'], recommendations: ['1', '2', '3', '4', '5'] };
    const { client } = fakeClient(textAnswer(JSON.stringify(long)));

    const result = await analyzeSunglassesImage(IMAGE, 'image/png', client);

    expect(result.cost_factors).toEqual(['a', 'b', 'c', 'd']);
    expect(result.recommendations).toEqual(['1', '2', '3', '4']);
  });

  it('forbids prices in the prompt and leaves room for the answer', async () => {
    const { client, create } = fakeClient(textAnswer(JSON.stringify(GOOD)));

    await analyzeSunglassesImage(IMAGE, 'image/png', client);

    expect(create.mock.calls[0][0].system).toMatch(/Never give a price/);
    // Thinking tokens count against max_tokens, so it must be well above the size of the answer.
    expect(create.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it('fails when the model refuses', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', content: [] });

    await expect(analyzeSunglassesImage(IMAGE, 'image/png', client)).rejects.toBeInstanceOf(
      ImageAnalysisFailedError
    );
  });

  it('fails when the answer has no text, is not JSON, or does not match the schema', async () => {
    const answers = [
      { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] },
      textAnswer('I think they are metal'),
      textAnswer(JSON.stringify({ ...GOOD, frame_material: 'gold' })),
      textAnswer(JSON.stringify({ ...GOOD, extra: true })),
      textAnswer(JSON.stringify({ is_sunglasses: true })),
      textAnswer(JSON.stringify({ ...GOOD, details: { frame: 'x' } })),
      textAnswer(JSON.stringify({ ...GOOD, complexity: 'extreme' }))
    ];

    for (const answer of answers) {
      const { client } = fakeClient(answer);
      await expect(analyzeSunglassesImage(IMAGE, 'image/png', client)).rejects.toBeInstanceOf(
        ImageAnalysisFailedError
      );
    }
  });

  it('lets an error of the API through unchanged', async () => {
    const create = jest.fn().mockRejectedValue(new Error('529 overloaded'));

    await expect(
      analyzeSunglassesImage(IMAGE, 'image/png', { messages: { create } } as unknown as MessagesClient)
    ).rejects.toThrow('529 overloaded');
  });
});
