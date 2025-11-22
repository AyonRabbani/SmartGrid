import { usePythonTask } from "../hooks/usePythonTask";

export default function PriceButton() {
  const { callPython } = usePythonTask();

  async function handleClick() {
    const result = await callPython("ping", {});
    alert("Python said: " + result);
  }

  return (
    <button onClick={handleClick}>
      Ask Python Something
    </button>
  );
}
