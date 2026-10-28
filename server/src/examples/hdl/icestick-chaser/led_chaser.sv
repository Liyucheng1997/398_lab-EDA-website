`timescale 1ns / 1ps

// iCEstick 流水灯：
//   · 围成一圈的 4 个红色 LED（D1~D4）依次点亮，形成旋转效果，每秒 STEP_HZ 步；
//   · 中央绿色 LED（D5）每秒闪烁一次（心跳）。
module led_chaser #(
  parameter CLK_HZ  = 12_000_000,  // 输入时钟频率（Hz）
  parameter STEP_HZ = 8            // 旋转速度：每秒步数（≥ 2 的偶数）
) (
  input  logic       clk,          // 12 MHz
  output logic [4:0] led           // led[3:0] = D1~D4（红），led[4] = D5（绿）
);
  localparam STEP_DIV = (CLK_HZ / STEP_HZ > 1) ? CLK_HZ / STEP_HZ : 2;
  localparam CW       = $clog2(STEP_DIV);
  localparam HALF_SEC = (STEP_HZ / 2 > 1) ? STEP_HZ / 2 : 1;   // 半秒包含的步数
  localparam SW       = $clog2(HALF_SEC + 1);

  logic [CW-1:0] div   = '0;
  logic [1:0]    pos   = '0;
  logic [SW-1:0] steps = '0;
  logic          heart = 1'b0;

  always_ff @(posedge clk) begin
    if (div == CW'(STEP_DIV - 1)) begin
      div <= '0;
      pos <= pos + 2'd1;                 // 顺时针转一格
      if (steps == SW'(HALF_SEC - 1)) begin
        steps <= '0;
        heart <= ~heart;                 // 每半秒翻转 => 1 Hz 闪烁
      end else begin
        steps <= steps + 1'b1;
      end
    end else begin
      div <= div + 1'b1;
    end
  end

  assign led[3:0] = 4'b0001 << pos;
  assign led[4]   = heart;
endmodule
