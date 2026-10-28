import type { Example } from '@webeda/shared';

// TODO(examples agent): 每个示例一个文件放在本目录，在这里汇总导出。
export const EXAMPLES: Example[] = [
  {
    id: 'counter',
    title: '4 位计数器',
    description: '带同步复位的 4 位计数器及其测试平台',
    category: 'basics',
    scope: 'playground',
    files: [
      {
        name: 'design.sv',
        role: 'design',
        content: `module counter (
  input  logic       clk,
  input  logic       rst,
  output logic [3:0] q
);
  always_ff @(posedge clk)
    if (rst) q <= '0;
    else     q <= q + 1'b1;
endmodule
`,
      },
      {
        name: 'testbench.sv',
        role: 'testbench',
        content: `module tb;
  logic clk = 0, rst = 1;
  logic [3:0] q;
  counter dut (.clk(clk), .rst(rst), .q(q));
  always #5 clk = ~clk;
  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    #12 rst = 0;
    #200;
    $display("q = %0d", q);
    $finish;
  end
endmodule
`,
      },
    ],
    simulate: { standard: '2012' },
  },
];
