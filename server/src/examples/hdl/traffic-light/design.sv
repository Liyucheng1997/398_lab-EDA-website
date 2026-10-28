`timescale 1ns / 1ps

// 十字路口交通灯控制器（南北 NS / 东西 EW），带行人过街请求。
//   NS 绿 → NS 黄 → 全红 → EW 绿 → EW 黄 → 全红 → ……
//   行人按下按钮后，在当前绿灯至少亮了 MIN_GREEN 拍时提前结束绿灯。
// 时间参数以「时钟周期」为单位，真实硬件中配合 1 Hz 的时钟使能使用。
module traffic_light #(
  parameter GREEN     = 20,  // 绿灯最长时间
  parameter MIN_GREEN = 5,   // 行人请求时绿灯的最短时间
  parameter YELLOW    = 4,
  parameter ALL_RED   = 2
) (
  input  logic       clk,
  input  logic       rst,
  input  logic       ped_req,  // 行人请求（单拍脉冲或电平均可）
  output logic [2:0] ns,       // {红, 黄, 绿}
  output logic [2:0] ew,
  output logic       walk      // 行人通行灯：全红阶段点亮
);
  typedef enum logic [2:0] {
    NS_GREEN  = 3'd0,
    NS_YELLOW = 3'd1,
    RED_1     = 3'd2,
    EW_GREEN  = 3'd3,
    EW_YELLOW = 3'd4,
    RED_2     = 3'd5
  } state_t;

  localparam TW = $clog2(GREEN + 1);

  state_t        state;
  logic [TW-1:0] timer;     // 当前状态已持续的周期数
  logic          ped_pending;

  logic [TW-1:0] limit;
  always_comb begin
    case (state)
      NS_GREEN, EW_GREEN:   limit = ped_pending ? TW'(MIN_GREEN) : TW'(GREEN);
      NS_YELLOW, EW_YELLOW: limit = TW'(YELLOW);
      default:              limit = TW'(ALL_RED);
    endcase
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      state       <= NS_GREEN;
      timer       <= '0;
      ped_pending <= 1'b0;
    end else begin
      // 全红阶段行人本来就可以通行，此时的请求无需记录
      if (ped_req && state != RED_1 && state != RED_2) ped_pending <= 1'b1;
      if (timer >= limit - 1'b1) begin
        timer <= '0;
        case (state)
          NS_GREEN:  state <= NS_YELLOW;
          NS_YELLOW: state <= RED_1;
          RED_1:     state <= EW_GREEN;
          EW_GREEN:  state <= EW_YELLOW;
          EW_YELLOW: state <= RED_2;
          default:   state <= NS_GREEN;
        endcase
        // 进入全红阶段即服务了行人请求
        if (state == NS_YELLOW || state == EW_YELLOW) ped_pending <= 1'b0;
      end else begin
        timer <= timer + 1'b1;
      end
    end
  end

  // 输出译码（Moore 型）
  always_comb begin
    ns   = 3'b100;
    ew   = 3'b100;
    walk = 1'b0;
    case (state)
      NS_GREEN:     ns = 3'b001;
      NS_YELLOW:    ns = 3'b010;
      EW_GREEN:     ew = 3'b001;
      EW_YELLOW:    ew = 3'b010;
      default:      walk = 1'b1;
    endcase
  end
endmodule
