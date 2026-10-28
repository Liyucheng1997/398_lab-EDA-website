`timescale 1ns / 1ps

// iCE40-HX8K Breakout 计数器：8 个 LED 以二进制显示一个每秒加 COUNT_HZ 次的计数值。
// 参数 GRAY = 1 时改为显示格雷码（相邻两个数只有一位变化）。
module led_counter #(
  parameter CLK_HZ   = 12_000_000,  // 输入时钟频率（Hz）
  parameter COUNT_HZ = 4,           // 每秒计数次数
  parameter GRAY     = 0            // 0 = 二进制，1 = 格雷码
) (
  input  logic       clk,           // 12 MHz
  output logic [7:0] led            // D9（led[0]）… D2（led[7]）
);
  localparam DIV = (CLK_HZ / COUNT_HZ > 1) ? CLK_HZ / COUNT_HZ : 2;
  localparam CW  = $clog2(DIV);

  logic [CW-1:0] div   = '0;
  logic [7:0]    count = '0;

  always_ff @(posedge clk) begin
    if (div == CW'(DIV - 1)) begin
      div   <= '0;
      count <= count + 8'd1;
    end else begin
      div <= div + 1'b1;
    end
  end

  assign led = GRAY ? (count ^ (count >> 1)) : count;
endmodule
