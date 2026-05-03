export interface FormState {
  id?: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  default: boolean;
  response_language: string;
  commit_language: string;
  max_output_tokens: string;
  context_window: string;
}

export const EMPTY_FORM: FormState = {
  name: '',
  base_url: '',
  api_key: '',
  model: '',
  default: false,
  response_language: 'auto',
  commit_language: 'inherit',
  max_output_tokens: '',
  context_window: '',
};
