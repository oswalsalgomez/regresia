import { runModelSelection } from '../engine/ols';
import { ModelSelectionOutput } from '../types/regression';

export interface ModelWorkerRequest {
  requestId: number;
  rows: Record<string, unknown>[];
  rowLabels: string[];
  yName: string;
  selectedX: string[];
  dummySetArray: string[];
  tryLogTransform: boolean;
  yUnit: string;
  dummyColumns: { name: string; sourceColumn: string }[];
}

export type ModelWorkerResponse =
  | {
      type: 'progress';
      requestId: number;
      completed: number;
      total: number;
      message: string;
    }
  | {
      type: 'result';
      requestId: number;
      output: ModelSelectionOutput;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };

const workerCtx = self as unknown as {
  onmessage: ((event: MessageEvent<ModelWorkerRequest>) => void) | null;
  postMessage: (message: ModelWorkerResponse) => void;
};

workerCtx.onmessage = (event: MessageEvent<ModelWorkerRequest>) => {
  const {
    requestId,
    rows,
    rowLabels,
    yName,
    selectedX,
    dummySetArray,
    tryLogTransform,
    yUnit,
    dummyColumns,
  } = event.data;

  try {
    const dummySet = new Set(dummySetArray);
    const output = runModelSelection(
      rows,
      rowLabels,
      yName,
      selectedX,
      dummySet,
      tryLogTransform,
      yUnit,
      dummyColumns,
      (completed, total, message) => {
        workerCtx.postMessage({
          type: 'progress',
          requestId,
          completed,
          total,
          message,
        });
      }
    );

    workerCtx.postMessage({
      type: 'result',
      requestId,
      output,
    });
  } catch (err) {
    workerCtx.postMessage({
      type: 'error',
      requestId,
      message:
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al estimar los modelos en segundo plano.',
    });
  }
};
