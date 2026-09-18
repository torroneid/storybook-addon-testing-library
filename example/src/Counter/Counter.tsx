import { useState } from 'react';

type Props = {
  start?: number;
  max?: number;
};

export const Counter = ({ start = 0, max = 10 }: Props) => {
  const [value, setValue] = useState(start);
  const atMax = value >= max;

  return (
    <div>
      <p>Value: {value}</p>
      <button type="button" onClick={() => setValue(current => current + 1)} disabled={atMax}>
        Add one
      </button>
      {atMax && <p role="status">Maximum reached</p>}
    </div>
  );
};
